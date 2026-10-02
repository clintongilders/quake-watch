<?php

namespace App\Command;

use App\Entity\Earthquake;
use App\Repository\EarthquakeRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Lock\LockFactory;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\Service\ResetInterface;
use Symfony\Bridge\Doctrine\Middleware\Debug\DebugDataHolder;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

#[AsCommand(
    name: 'app:import-earthquakes',
    description: 'Imports recent earthquakes from the USGS API',
)]
class ImportEarthquakesCommand extends Command
{
    public function __construct(
        private HttpClientInterface $httpClient,
        private EntityManagerInterface $entityManager,
        private EarthquakeRepository $earthquakeRepository,
        private LockFactory $lockFactory,
        #[Autowire(service: 'doctrine.debug_data_holder')]
        private ?DebugDataHolder $debugDataHolder = null,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->addOption('from', null, InputOption::VALUE_REQUIRED, 'First UTC day to import (YYYY-MM-DD)');
        $this->addOption('to', null, InputOption::VALUE_REQUIRED, 'Last UTC day to import, inclusive (YYYY-MM-DD)');
        $this->addOption('watch', null, InputOption::VALUE_NONE, 'Import immediately and every five minutes until stopped');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $from = $input->getOption('from');
        $to = $input->getOption('to');
        if ($from !== null || $to !== null) {
            $validDate = static function (mixed $value): bool {
                if (!is_string($value)) return false;
                $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, new \DateTimeZone('UTC'));
                return $date !== false && $date->format('Y-m-d') === $value;
            };
            if (!$validDate($from) || !$validDate($to) || $from > $to || $input->getOption('watch')) {
                $output->writeln('<error>Use both --from and --to as valid YYYY-MM-DD dates, with from on or before to. Historical imports cannot use --watch.</error>');
                return Command::INVALID;
            }
        }
        do {
            $lock = $this->lockFactory->createLock('earthquake-import', 300);
            if (!$lock->acquire()) {
                $output->writeln('Another import is running; skipping.');
                if (!$input->getOption('watch')) return Command::FAILURE;
            } else {
                try {
                    $this->import($output, $from, $to, $lock);
                } catch (\Throwable $error) {
                    $output->writeln('<error>Import failed: '.$error->getMessage().'</error>');
                    if (!$input->getOption('watch')) return Command::FAILURE;
                } finally {
                    $lock->release();
                    $this->entityManager->clear();
                }
            }
            if ($input->getOption('watch')) sleep(300);
        } while ($input->getOption('watch'));
        return Command::SUCCESS;
    }

    /** @return \Generator<array> */
    private function batches(?string $from, ?string $to): \Generator
    {
        $options = ['timeout' => 30, 'max_duration' => 60, 'extra' => ['trace_content' => false]];
        if ($from === null) {
            yield $this->httpClient->request('GET', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', $options)->toArray()['features'];
            return;
        }

        $day = new \DateTimeImmutable($from, new \DateTimeZone('UTC'));
        $last = new \DateTimeImmutable($to, new \DateTimeZone('UTC'));
        while ($day <= $last) {
            $offset = 1;
            do {
                $response = $this->httpClient->request('GET', 'https://earthquake.usgs.gov/fdsnws/event/1/query', $options + [
                    'query' => [
                        'format' => 'geojson', 'eventtype' => 'earthquake',
                        'starttime' => $day->format('Y-m-d').'T00:00:00Z',
                        'endtime' => $day->format('Y-m-d').'T23:59:59.999Z',
                        'orderby' => 'time-asc', 'limit' => 1000, 'offset' => $offset,
                    ],
                ]);
                $features = $response->getStatusCode() === 204 ? [] : $response->toArray()['features'];
                yield $features;
                $offset += count($features);
            } while (count($features) === 1000);
            $day = $day->modify('+1 day');
        }
    }

    private function import(OutputInterface $output, ?string $from, ?string $to, \Symfony\Component\Lock\LockInterface $lock): void
    {
        $imported = 0;
        $updated = 0;

        foreach ($this->batches($from, $to) as $features) {
            $lock->refresh();
            $pending = 0;
            foreach ($features as $feature) {
                $usgsId = $feature['id'];

                $existing = $this->earthquakeRepository->findOneBy([
                    'usgsId' => $usgsId,
                ]);

                $properties = $feature['properties'];
                $coordinates = $feature['geometry']['coordinates'];

                $earthquake = $existing ?? new Earthquake();

                $earthquake->setUsgsId($usgsId);
                $earthquake->setMagnitude($properties['mag'] ?? 0);
                $earthquake->setPlace($properties['place'] ?? 'Unknown');
                $earthquake->setOccurredAt(
                    (new \DateTimeImmutable())
                        ->setTimestamp((int) ($properties['time'] / 1000))
                );

                $earthquake->setLongitude($coordinates[0]);
                $earthquake->setLatitude($coordinates[1]);
                $earthquake->setDepth($coordinates[2]);

                $this->entityManager->persist($earthquake);

                if ($existing) $updated++;
                else $imported++;
                if (++$pending === 100) {
                    $this->saveBatch();
                    $pending = 0;
                    $lock->refresh();
                }
            }
            if ($pending > 0) $this->saveBatch();
            $this->debugDataHolder?->reset();
            if ($this->httpClient instanceof ResetInterface) $this->httpClient->reset();
            $output->writeln(sprintf('Progress: %d new; %d refreshed.', $imported, $updated));
        }

        $output->writeln(sprintf(
            'Imported %d new earthquakes; refreshed %d existing records at %s.',
            $imported, $updated, gmdate('c')
        ));

    }
    private function saveBatch(): void
    {
        $this->entityManager->flush();
        $this->entityManager->clear();
        // SQL traces retain queries and backtraces even after ORM entities are cleared.
        $this->debugDataHolder?->reset();
    }

}
