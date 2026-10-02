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
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->addOption('watch', null, InputOption::VALUE_NONE, 'Import immediately and every five minutes until stopped');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        do {
            $lock = $this->lockFactory->createLock('earthquake-import', 300);
            if (!$lock->acquire()) {
                $output->writeln('Another import is running; skipping.');
            } else {
                try {
                    $this->import($output);
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

    private function import(OutputInterface $output): void
    {
        $response = $this->httpClient->request(
            'GET',
            'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
            ['timeout' => 30, 'max_duration' => 60]
        );

        $data = $response->toArray();

        $imported = 0;
        $updated = 0;

        foreach ($data['features'] as $feature) {
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
        }

        $this->entityManager->flush();

        $output->writeln(sprintf(
            'Imported %d new earthquakes; refreshed %d existing records at %s.',
            $imported, $updated, gmdate('c')
        ));

    }
}
