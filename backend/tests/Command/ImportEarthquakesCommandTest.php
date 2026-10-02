<?php

namespace App\Tests\Command;

use App\Command\ImportEarthquakesCommand;
use App\Entity\Earthquake;
use App\Repository\EarthquakeRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\Lock\LockFactory;
use Symfony\Component\Lock\Store\FlockStore;

final class ImportEarthquakesCommandTest extends KernelTestCase
{
    public function testImportRefreshesExistingRecordsAndInsertsNewOnes(): void
    {
        $existing = (new Earthquake())->setUsgsId('existing')->setMagnitude(2);
        $repository = $this->createStub(EarthquakeRepository::class);
        $repository->method('findOneBy')->willReturnCallback(
            static fn (array $criteria) => $criteria['usgsId'] === 'existing' ? $existing : null
        );
        $records = [];
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->expects(self::exactly(2))->method('persist')->willReturnCallback(
            static function (Earthquake $quake) use (&$records): void { $records[] = $quake; }
        );
        $manager->expects(self::once())->method('flush');
        $manager->expects(self::once())->method('clear');
        $features = array_map(static fn (string $id) => [
            'id' => $id,
            'properties' => ['mag' => 4.5, 'place' => 'Test location', 'time' => 1760000000000],
            'geometry' => ['coordinates' => [-123, 49, 12]],
        ], ['existing', 'new']);
        $http = new MockHttpClient(new MockResponse(json_encode(['features' => $features], JSON_THROW_ON_ERROR)));
        $tester = new CommandTester(new ImportEarthquakesCommand($http, $manager, $repository, new LockFactory(new FlockStore())));
        self::assertSame(0, $tester->execute([]));
        self::assertSame(4.5, $existing->getMagnitude());
        self::assertSame('Test location', $existing->getPlace());
        self::assertSame(49.0, $records[1]->getLatitude());
        self::assertSame(-123.0, $records[1]->getLongitude());
        self::assertSame(12.0, $records[1]->getDepth());
        self::assertStringContainsString('Imported 1 new earthquakes; refreshed 1 existing', $tester->getDisplay());
    }
}
