<?php

namespace App\Command;

use App\Service\EarthquakeWriter;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Lock\LockFactory;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\Service\ResetInterface;

#[AsCommand(name: 'app:import-earthquakes', description: 'Imports earthquakes from USGS, recovering gaps since the last successful run')]
class ImportEarthquakesCommand extends Command
{
    public function __construct(private HttpClientInterface $httpClient, private EarthquakeWriter $writer, private LockFactory $lockFactory)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->addOption('from', null, InputOption::VALUE_REQUIRED, 'First UTC day (YYYY-MM-DD)');
        $this->addOption('to', null, InputOption::VALUE_REQUIRED, 'Last UTC day, inclusive (YYYY-MM-DD)');
        $this->addOption('watch', null, InputOption::VALUE_NONE, 'Removed: schedule one-shot imports with cron instead');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $from = $input->getOption('from');
        $to = $input->getOption('to');
        $validDate = static function (mixed $value): bool {
            if (!is_string($value)) {
                return false;
            }
            $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, new \DateTimeZone('UTC'));

            return false !== $date && $date->format('Y-m-d') === $value;
        };
        if ($input->getOption('watch')) {
            $output->writeln('<error>--watch was removed. Schedule a fresh one-shot process every five minutes with cron; see README.</error>');

            return Command::INVALID;
        }
        if ((null !== $from || null !== $to) && (!$validDate($from) || !$validDate($to) || $from > $to)) {
            $output->writeln('<error>Use both --from and --to as valid YYYY-MM-DD dates, with from on or before to.</error>');

            return Command::INVALID;
        }
        $lock = $this->lockFactory->createLock('earthquake-import', 300);
        if (!$lock->acquire()) {
            $output->writeln('Another import is running; skipping.');

            return Command::SUCCESS;
        }
        try {
            $started = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            $imported = $updated = $skipped = 0;
            foreach ($this->batches($from, $to, $started) as $features) {
                $lock->refresh();
                $rows = [];
                foreach ($features as $feature) {
                    if (($feature['properties']['type'] ?? null) !== 'earthquake') {
                        ++$skipped;
                        continue;
                    }
                    $row = $this->row($feature);
                    if (null === $row) {
                        ++$skipped;
                        continue;
                    }
                    $rows[] = $row;
                }
                foreach (array_chunk($rows, 100) as $batch) {
                    $lock->refresh();
                    [$new, $changed] = $this->writer->write($batch);
                    $imported += $new;
                    $updated += $changed;
                }
                if ($this->httpClient instanceof ResetInterface) {
                    $this->httpClient->reset();
                }
                $output->writeln(sprintf('Progress: %d new; %d refreshed; %d skipped.', $imported, $updated, $skipped));
            }
            if (null === $from) {
                $this->writer->complete($started);
            }
            $output->writeln(sprintf('Imported %d new earthquakes; refreshed %d existing records; skipped %d non-earthquake or malformed records.', $imported, $updated, $skipped));

            return Command::SUCCESS;
        } catch (\Throwable $error) {
            $output->writeln('<error>Import failed: '.$error->getMessage().'</error>');

            return Command::FAILURE;
        } finally {
            $lock->release();
        }
    }

    private function row(mixed $feature): ?array
    {
        if (!is_array($feature) || !is_array($feature['properties'] ?? null) || !is_array($feature['geometry']['coordinates'] ?? null)) {
            return null;
        }
        $id = $feature['id'] ?? null;
        $p = $feature['properties'];
        $c = $feature['geometry']['coordinates'] ?? [];
        if (!is_string($id) || '' === $id || strlen($id) > 255 || (!is_numeric($p['time'] ?? null) || !is_finite((float) $p['time'])) || count($c) < 3) {
            return null;
        }
        foreach (array_slice($c, 0, 3) as $coordinate) {
            if (!is_numeric($coordinate) || !is_finite((float) $coordinate)) {
                return null;
            }
        }
        if (abs((float) $c[0]) > 180 || abs((float) $c[1]) > 90) {
            return null;
        }
        $mag = $p['mag'] ?? null;
        if (null !== $mag && (!is_numeric($mag) || !is_finite((float) $mag))) {
            return null;
        }
        $time = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->setTimestamp((int) ((float) $p['time'] / 1000));

        return [$id, null === $mag ? null : (float) $mag, mb_substr(is_string($p['place'] ?? null) ? $p['place'] : 'Unknown', 0, 255), $time->format('Y-m-d H:i:s'), (float) $c[0], (float) $c[1], (float) $c[2]];
    }

    private function batches(?string $from, ?string $to, \DateTimeImmutable $started): \Generator
    {
        if (null !== $from) {
            yield from $this->history($from, $to);

            return;
        }
        $checkpoint = $this->writer->lastSuccessfulImport();
        // Replay an overlapping day to cover late updates and interruptions.
        if (null !== $checkpoint && $checkpoint < $started->modify('-1 day')) {
            yield from $this->history($checkpoint->modify('-1 day')->format('Y-m-d'), $started->format('Y-m-d'));
        }
        yield $this->httpClient->request('GET', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', $this->options())->toArray()['features'];
    }

    private function options(): array
    {
        return ['timeout' => 30, 'max_duration' => 60, 'extra' => ['trace_content' => false]];
    }

    private function history(string $from, string $to): \Generator
    {
        $day = new \DateTimeImmutable($from, new \DateTimeZone('UTC'));
        $last = new \DateTimeImmutable($to, new \DateTimeZone('UTC'));
        while ($day <= $last) {
            $offset = 1;
            do {
                $response = $this->httpClient->request('GET', 'https://earthquake.usgs.gov/fdsnws/event/1/query', $this->options() + ['query' => [
                    'format' => 'geojson', 'eventtype' => 'earthquake', 'starttime' => $day->format('Y-m-d').'T00:00:00Z',
                    'endtime' => $day->format('Y-m-d').'T23:59:59.999Z', 'orderby' => 'time-asc', 'limit' => 1000, 'offset' => $offset,
                ]]);
                $features = 204 === $response->getStatusCode() ? [] : $response->toArray()['features'];
                yield $features;
                $offset += count($features);
            } while (1000 === count($features));
            $day = $day->modify('+1 day');
        }
    }
}
