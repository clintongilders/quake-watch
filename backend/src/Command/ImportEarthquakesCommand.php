<?php

namespace App\Command;

use App\Entity\Earthquake;
use App\Repository\EarthquakeRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
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
    ) {
        parent::__construct();
    }

    protected function execute(
        InputInterface $input,
        OutputInterface $output
    ): int {
        $response = $this->httpClient->request(
            'GET',
            'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
        );

        $data = $response->toArray();

        $imported = 0;

        foreach ($data['features'] as $feature) {
            $usgsId = $feature['id'];

            $existing = $this->earthquakeRepository->findOneBy([
                'usgsId' => $usgsId,
            ]);

            if ($existing) {
                continue;
            }

            $properties = $feature['properties'];
            $coordinates = $feature['geometry']['coordinates'];

            $earthquake = new Earthquake();

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

            $imported++;
        }

        $this->entityManager->flush();

        $output->writeln(sprintf(
            'Imported %d earthquakes.',
            $imported
        ));

        return Command::SUCCESS;
    }
}
