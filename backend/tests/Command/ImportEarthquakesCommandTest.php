<?php

namespace App\Tests\Command;

use App\Command\ImportEarthquakesCommand;
use App\Entity\Earthquake;
use Symfony\Bridge\Doctrine\Middleware\Debug\DebugDataHolder;
use App\Repository\EarthquakeRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\Lock\LockFactory;
use Symfony\Component\Lock\Store\InMemoryStore;

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
        $manager->expects(self::exactly(2))->method('clear');
        $features = array_map(static fn (string $id) => [
            'id' => $id,
            'properties' => ['mag' => 4.5, 'place' => 'Test location', 'time' => 1760000000000],
            'geometry' => ['coordinates' => [-123, 49, 12]],
        ], ['existing', 'new']);
        $http = new MockHttpClient(new MockResponse(json_encode(['features' => $features], JSON_THROW_ON_ERROR)));
        $tester = new CommandTester(new ImportEarthquakesCommand($http, $manager, $repository, new LockFactory(new InMemoryStore())));
        self::assertSame(0, $tester->execute([]));
        self::assertSame(4.5, $existing->getMagnitude());
        self::assertSame('Test location', $existing->getPlace());
        self::assertSame(49.0, $records[1]->getLatitude());
        self::assertSame(-123.0, $records[1]->getLongitude());
        self::assertSame(12.0, $records[1]->getDepth());
        self::assertStringContainsString('Imported 1 new earthquakes; refreshed 1 existing', $tester->getDisplay());
    }
    public function testHistoricalImportPaginatesAndHandlesAnEmptyDay(): void
    {
        $feature = static fn (int $id) => [
            'id' => 'history-'.$id,
            'properties' => ['mag' => 3.2, 'place' => 'Historical event', 'time' => 1750000000000],
            'geometry' => ['coordinates' => [-120, 40, 10]],
        ];
        $requests = [];
        $http = new MockHttpClient(static function (string $method, string $url) use (&$requests, $feature): MockResponse {
            parse_str(parse_url($url, PHP_URL_QUERY), $query);
            $requests[] = $query;
            $features = match (count($requests)) {
                1 => array_map($feature, range(1, 1000)),
                2 => [$feature(1001)],
                default => [],
            };
            return new MockResponse(json_encode(['features' => $features]), ['http_code' => $features ? 200 : 204]);
        });
        $repository = $this->createStub(EarthquakeRepository::class);
        $repository->method('findOneBy')->willReturn(null);
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->expects(self::exactly(1001))->method('persist');
        $manager->expects(self::exactly(11))->method('flush');
        $manager->expects(self::exactly(12))->method('clear');
        $debugData = $this->createMock(DebugDataHolder::class);
        $debugData->expects(self::exactly(14))->method('reset');
        $tester = new CommandTester(new ImportEarthquakesCommand($http, $manager, $repository, new LockFactory(new InMemoryStore()), $debugData));
        self::assertSame(0, $tester->execute(['--from' => '2026-09-01', '--to' => '2026-09-02']));
        self::assertCount(3, $requests);
        self::assertSame('2026-09-01T00:00:00Z', $requests[0]['starttime']);
        self::assertSame('2026-09-01T23:59:59.999Z', $requests[0]['endtime']);
        self::assertSame('1001', $requests[1]['offset']);
        self::assertSame('2026-09-02T00:00:00Z', $requests[2]['starttime']);
        self::assertSame('1', $requests[2]['offset']);
        self::assertStringContainsString('Imported 1001 new earthquakes', $tester->getDisplay());
    }

    public function testInvalidRangesAreRejectedBeforeFetching(): void
    {
        $http = new MockHttpClient(static function (): never { self::fail('Invalid dates must not trigger HTTP requests.'); });
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->expects(self::never())->method('persist');
        $tester = new CommandTester(new ImportEarthquakesCommand($http, $manager, $this->createStub(EarthquakeRepository::class), new LockFactory(new InMemoryStore())));
        foreach ([
            ['--from' => '2026-09-01'],
            ['--from' => '2026-02-30', '--to' => '2026-03-01'],
            ['--from' => '2026-09-02', '--to' => '2026-09-01'],
            ['--from' => '2026-09-01', '--to' => '2026-09-02', '--watch' => true],
        ] as $options) {
            self::assertSame(2, $tester->execute($options));
        }
    }

    public function testBusyLockPreventsRequests(): void
    {
        $factory = new LockFactory(new InMemoryStore());
        $lock = $factory->createLock('earthquake-import', 300);
        self::assertTrue($lock->acquire());
        $http = new MockHttpClient(static function (): never { self::fail('A competing import must not fetch data.'); });
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->expects(self::never())->method('persist');
        $tester = new CommandTester(new ImportEarthquakesCommand($http, $manager, $this->createStub(EarthquakeRepository::class), $factory));
        try {
            self::assertSame(1, $tester->execute([]));
            self::assertStringContainsString('Another import is running', $tester->getDisplay());
        } finally {
            $lock->release();
        }
    }

    public function testHttpFailureReleasesLockAndAllowsRetry(): void
    {
        $attempts = 0;
        $http = new MockHttpClient(static function () use (&$attempts): MockResponse {
            return ++$attempts === 1 ? new MockResponse('', ['http_code' => 503]) : new MockResponse('{"features":[]}');
        });
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->expects(self::exactly(2))->method('clear');
        $manager->expects(self::never())->method('persist');
        $manager->expects(self::never())->method('flush');
        $tester = new CommandTester(new ImportEarthquakesCommand($http, $manager, $this->createStub(EarthquakeRepository::class), new LockFactory(new InMemoryStore())));
        self::assertSame(1, $tester->execute([]));
        self::assertStringContainsString('Import failed:', $tester->getDisplay());
        self::assertSame(0, $tester->execute([]));
        self::assertSame(2, $attempts);
    }

    public function testFlushFailureClearsEntitiesAndReleasesLock(): void
    {
        $feature = ['id' => 'failed', 'properties' => ['mag' => null, 'place' => null, 'time' => 1760000000000], 'geometry' => ['coordinates' => [-123, 49, 12]]];
        $http = new MockHttpClient(new MockResponse(json_encode(['features' => [$feature]], JSON_THROW_ON_ERROR)));
        $manager = $this->createMock(EntityManagerInterface::class);
        $manager->expects(self::once())->method('persist')->willReturnCallback(static function (Earthquake $quake): void {
            self::assertSame(0.0, $quake->getMagnitude());
            self::assertSame('Unknown', $quake->getPlace());
        });
        $manager->expects(self::once())->method('flush')->willThrowException(new \RuntimeException('Database unavailable'));
        $manager->expects(self::once())->method('clear');
        $factory = new LockFactory(new InMemoryStore());
        $tester = new CommandTester(new ImportEarthquakesCommand($http, $manager, $this->createStub(EarthquakeRepository::class), $factory));
        self::assertSame(1, $tester->execute([]));
        self::assertStringContainsString('Database unavailable', $tester->getDisplay());
        $lock = $factory->createLock('earthquake-import', 300);
        self::assertTrue($lock->acquire());
        $lock->release();
    }

}
