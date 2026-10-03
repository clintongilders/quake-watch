<?php

namespace App\Tests\Command;

use App\Command\ImportEarthquakesCommand;
use App\Service\EarthquakeWriter;
use App\Tests\Support\Database;
use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\Lock\LockFactory;
use Symfony\Component\Lock\Store\InMemoryStore;

final class ImportEarthquakesCommandTest extends KernelTestCase
{
    use Database;
    private Connection $db;
    private EarthquakeWriter $writer;
    private LockFactory $locks;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->db = $this->freshDatabase()->getConnection();
        $this->writer = new EarthquakeWriter($this->db);
        $this->locks = new LockFactory(new InMemoryStore());
    }

    private function feature(string $id = 'test', mixed $magnitude = 4.5): array
    {
        return ['id' => $id, 'properties' => ['type' => 'earthquake', 'mag' => $magnitude, 'place' => 'Test', 'time' => 1756814400000], 'geometry' => ['coordinates' => [-123, 49, 12]]];
    }

    private function tester(MockHttpClient $http): CommandTester
    {
        return new CommandTester(new ImportEarthquakesCommand($http, $this->writer, $this->locks));
    }

    private function response(array $features): MockResponse
    {
        return new MockResponse(json_encode(['features' => $features], JSON_THROW_ON_ERROR));
    }

    public function testUpsertAndNullMagnitudePreserveOneRecord(): void
    {
        $tester = $this->tester(new MockHttpClient([$this->response([$this->feature()]), $this->response([$this->feature('test', null)])]));
        self::assertSame(0, $tester->execute([]));
        self::assertSame(0, $tester->execute([]));
        self::assertSame(1, (int) $this->db->fetchOne('SELECT COUNT(*) FROM earthquake'));
        self::assertNull($this->db->fetchOne('SELECT magnitude FROM earthquake'));
        self::assertStringContainsString('refreshed 1 existing', $tester->getDisplay());
    }

    public function testPreferredIdChangeReplacesTheSupersededRecord(): void
    {
        $merged = $this->feature('us2');
        $merged['properties']['ids'] = ',test,us2,';
        $tester = $this->tester(new MockHttpClient([$this->response([$this->feature(), $this->feature('other')]), $this->response([$merged])]));
        self::assertSame(0, $tester->execute([]));
        self::assertSame(0, $tester->execute([]));
        self::assertEqualsCanonicalizing(['other', 'us2'], $this->db->fetchFirstColumn('SELECT usgs_id FROM earthquake'));
    }

    public function testUnknownDepthIsStoredAsNull(): void
    {
        $feature = $this->feature();
        $feature['geometry']['coordinates'][2] = null;
        $tester = $this->tester(new MockHttpClient($this->response([$feature])));
        self::assertSame(0, $tester->execute([]));
        self::assertSame(1, (int) $this->db->fetchOne('SELECT COUNT(*) FROM earthquake'));
        self::assertNull($this->db->fetchOne('SELECT depth FROM earthquake'));
    }

    public function testTimestampIsUtcEvenWithNonUtcPhpTimezone(): void
    {
        $previous = date_default_timezone_get();
        date_default_timezone_set('America/Vancouver');
        try {
            $tester = $this->tester(new MockHttpClient($this->response([$this->feature()])));
            self::assertSame(0, $tester->execute([]));
            self::assertSame('2025-09-02 12:00:00', $this->db->fetchOne('SELECT occurred_at FROM earthquake'));
        } finally {
            date_default_timezone_set($previous);
        }
    }

    public function testMalformedAndNonEarthquakeRecordsDoNotAbortValidRecords(): void
    {
        $blast = $this->feature('blast');
        $blast['properties']['type'] = 'quarry blast';
        $invalid = $this->feature('invalid');
        $invalid['properties']['time'] = null;
        $tester = $this->tester(new MockHttpClient($this->response([$blast, $invalid, $this->feature()])));
        self::assertSame(0, $tester->execute([]));
        self::assertSame(['test'], $this->db->fetchFirstColumn('SELECT usgs_id FROM earthquake'));
        self::assertStringContainsString('skipped 2', $tester->getDisplay());
    }

    public function testHistoricalPaginationAndEmptyDay(): void
    {
        $requests = [];
        $http = new MockHttpClient(function (string $method, string $url) use (&$requests): MockResponse {
            parse_str(parse_url($url, PHP_URL_QUERY), $query);
            $requests[] = $query;

            return match (count($requests)) {
                1 => $this->response(array_map(fn ($id) => $this->feature('history-'.$id), range(1, 1000))),
                2 => $this->response([$this->feature('history-1001')]),
                default => new MockResponse('', ['http_code' => 204]),
            };
        });
        self::assertSame(0, $this->tester($http)->execute(['--from' => '2026-09-01', '--to' => '2026-09-02']));
        self::assertSame(1001, (int) $this->db->fetchOne('SELECT COUNT(*) FROM earthquake'));
        self::assertSame('1001', $requests[1]['offset']);
        self::assertSame('earthquake', $requests[0]['eventtype']);
        self::assertSame('2026-09-02T00:00:00Z', $requests[2]['starttime']);
        self::assertNull($this->writer->lastSuccessfulImport());
    }

    public function testInvalidRangesNeverFetch(): void
    {
        $tester = $this->tester(new MockHttpClient(static function (): never { self::fail('Invalid input must not fetch.'); }));
        foreach ([['--from' => '2026-09-01'], ['--from' => '2026-02-30', '--to' => '2026-03-01'], ['--from' => '2026-09-02', '--to' => '2026-09-01'], ['--watch' => true]] as $input) {
            self::assertSame(2, $tester->execute($input));
        }
    }

    public function testBusyImportIsSkippedWithoutFetching(): void
    {
        $lock = $this->locks->createLock('earthquake-import', 300);
        $lock->acquire();
        try {
            $tester = $this->tester(new MockHttpClient(static function (): never { self::fail('Busy import must not fetch.'); }));
            self::assertSame(0, $tester->execute([]));
            self::assertStringContainsString('skipping', $tester->getDisplay());
        } finally {
            $lock->release();
        }
    }

    public function testHttpFailureDoesNotAdvanceCheckpointAndRetryWorks(): void
    {
        $tester = $this->tester(new MockHttpClient([new MockResponse('', ['http_code' => 503]), $this->response([$this->feature()])]));
        self::assertSame(1, $tester->execute([]));
        self::assertNull($this->writer->lastSuccessfulImport());
        self::assertSame(0, $tester->execute([]));
        self::assertNotNull($this->writer->lastSuccessfulImport());
    }

    public function testRealDatabaseFailureRollsBackBatchAndNextImportWorks(): void
    {
        if ($this->db->getDatabasePlatform() instanceof \Doctrine\DBAL\Platforms\SQLitePlatform) {
            self::markTestSkipped('Real constraint recovery is exercised on PostgreSQL in CI.');
        }
        $this->db->executeStatement('ALTER TABLE earthquake ADD CONSTRAINT reject_test CHECK (magnitude < 4)');
        $tester = $this->tester(new MockHttpClient([$this->response([$this->feature()]), $this->response([$this->feature('test', 3)])]));
        self::assertSame(1, $tester->execute([]));
        self::assertSame(0, (int) $this->db->fetchOne('SELECT COUNT(*) FROM earthquake'));
        self::assertFalse($this->db->isTransactionActive());
        self::assertSame(0, $tester->execute([]));
        self::assertEquals(3, $this->db->fetchOne('SELECT magnitude FROM earthquake'));
    }

    public function testLiveImportRecoversGapFromCheckpoint(): void
    {
        $this->writer->complete(new \DateTimeImmutable('-3 days', new \DateTimeZone('UTC')));
        $urls = [];
        $http = new MockHttpClient(function (string $method, string $url) use (&$urls): MockResponse {
            $urls[] = $url;

            return $this->response([]);
        });
        self::assertSame(0, $this->tester($http)->execute([]));
        self::assertGreaterThan(2, count($urls));
        self::assertStringContainsString('/fdsnws/event/1/query', $urls[0]);
        self::assertStringContainsString('all_day.geojson', $urls[array_key_last($urls)]);
    }
}
