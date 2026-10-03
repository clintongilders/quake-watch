<?php

namespace App\Tests\Controller;

use App\Entity\Earthquake;
use App\Tests\Support\Database;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** Runs on SQLite locally or PostgreSQL in CI, never development data. */
final class EarthquakeControllerTest extends WebTestCase
{
    use Database;
    private KernelBrowser $client;

    protected function setUp(): void
    {
        parent::setUp();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $manager = $this->freshDatabase();
        foreach ([[1, 2.0, 30.0], [2, 5.0, 10.0], [3, 3.0, 20.0]] as [$day, $magnitude, $depth]) {
            $manager->persist((new Earthquake())->setUsgsId('test-'.$day)->setPlace('Test '.$day)
                ->setMagnitude($magnitude)->setDepth($depth)->setLatitude(49)->setLongitude(-123)
                ->setOccurredAt(new \DateTimeImmutable('2026-09-0'.$day.'T12:00:00Z')));
        }
        $manager->flush();
    }

    private function collection(array $query = []): array
    {
        $this->client->request('GET', '/api/earthquakes?'.http_build_query($query), server: ['HTTP_ACCEPT' => 'application/ld+json']);
        self::assertResponseIsSuccessful();

        return json_decode($this->client->getResponse()->getContent(), true, flags: JSON_THROW_ON_ERROR);
    }

    public function testDefaultOrderAndMapCoordinates(): void
    {
        $data = $this->collection();
        self::assertSame(3, $data['totalItems']);
        self::assertStringContainsString('max-age=60', $this->client->getResponse()->headers->get('Cache-Control'));
        self::assertSame(['test-3', 'test-2', 'test-1'], array_column($data['member'], 'usgsId'));
        self::assertEquals(49, $data['member'][0]['latitude']);
        self::assertEquals(-123, $data['member'][0]['longitude']);
    }

    public function testCombinedFiltersAndEmptyResults(): void
    {
        $data = $this->collection(['magnitude' => ['gte' => 3], 'depth' => ['lte' => 20],
            'occurredAt' => ['after' => '2026-09-02T12:00:00Z', 'before' => '2026-09-02T12:00:00Z']]);
        self::assertSame(1, $data['totalItems']);
        self::assertSame(['test-2'], array_column($data['member'], 'usgsId'));
        self::assertSame([], $this->collection(['magnitude' => ['gte' => 9]])['member']);
    }

    public static function sorts(): iterable
    {
        yield ['sortMagnitude', 'asc', ['test-1', 'test-3', 'test-2']];
        yield ['sortMagnitude', 'desc', ['test-2', 'test-3', 'test-1']];
        yield ['sortDepth', 'asc', ['test-2', 'test-3', 'test-1']];
        yield ['sortDepth', 'desc', ['test-1', 'test-3', 'test-2']];
        yield ['sortOccurredAt', 'asc', ['test-1', 'test-2', 'test-3']];
        yield ['sortOccurredAt', 'desc', ['test-3', 'test-2', 'test-1']];
    }

    #[DataProvider('sorts')]
    public function testSorting(string $parameter, string $direction, array $expected): void
    {
        self::assertSame($expected, array_column($this->collection([$parameter => $direction])['member'], 'usgsId'));
    }

    public function testUnknownValuesSortLastAndSerializeAsNull(): void
    {
        $db = static::getContainer()->get(\Doctrine\DBAL\Connection::class);
        $db->executeStatement("UPDATE earthquake SET magnitude = NULL, depth = NULL WHERE usgs_id = 'test-2'");
        static::getContainer()->get(\Doctrine\ORM\EntityManagerInterface::class)->clear();
        foreach (['sortMagnitude', 'sortDepth'] as $parameter) {
            foreach (['asc', 'desc'] as $direction) {
                $members = $this->collection([$parameter => $direction])['member'];
                self::assertCount(3, $members);
                self::assertSame('test-2', $members[2]['usgsId']);
                self::assertArrayHasKey('magnitude', $members[2]);
                self::assertNull($members[2]['magnitude']);
                self::assertArrayHasKey('depth', $members[2]);
                self::assertNull($members[2]['depth']);
            }
        }
        $this->client->request('GET', '/api/earthquakes/map');
        $features = json_decode($this->client->getResponse()->getContent(), true, flags: JSON_THROW_ON_ERROR)['features'];
        $coordinates = array_column($features, 'geometry', 'id')['test-2']['coordinates'];
        self::assertEquals([-123, 49], array_slice($coordinates, 0, 2));
        self::assertNull($coordinates[2]);
    }

    public function testPaginationLinksPreserveTotals(): void
    {
        $data = $this->collection(['itemsPerPage' => 2]);
        self::assertSame(3, $data['totalItems']);
        self::assertCount(2, $data['member']);
        $this->client->request('GET', $data['view']['next'], server: ['HTTP_ACCEPT' => 'application/ld+json']);
        self::assertResponseIsSuccessful();
        $last = json_decode($this->client->getResponse()->getContent(), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(['test-1'], array_column($last['member'], 'usgsId'));
        self::assertArrayNotHasKey('next', $last['view']);
        self::assertSame(3, $last['totalItems']);
    }

    public function testItemIsReadableAndCollectionIsReadOnly(): void
    {
        $data = $this->collection();
        $this->client->request('GET', $data['member'][0]['@id']);
        self::assertResponseIsSuccessful();
        $this->client->request('POST', '/api/earthquakes', server: ['CONTENT_TYPE' => 'application/ld+json'], content: '{}');
        self::assertResponseStatusCodeSame(405);
    }

    public function testMapFiltersCoordinatesAndConditionalCaching(): void
    {
        $url = '/api/earthquakes/map?'.http_build_query(['magnitude' => ['gte' => 3], 'south' => 48, 'north' => 50]);
        $this->client->request('GET', $url);
        self::assertResponseIsSuccessful();
        $response = $this->client->getResponse();
        $data = json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('FeatureCollection', $data['type']);
        self::assertSame(2, $data['totalItems']);
        self::assertFalse($data['truncated']);
        self::assertSame('test-3', $data['features'][0]['id']);
        self::assertEquals([-123, 49, 20], $data['features'][0]['geometry']['coordinates']);
        self::assertStringContainsString('public', $response->headers->get('Cache-Control'));
        $this->client->request('GET', $url, server: ['HTTP_IF_NONE_MATCH' => $response->getEtag()]);
        self::assertResponseStatusCodeSame(304);
    }

    public function testMapRejectsInvalidFilters(): void
    {
        foreach (['magnitude[gte]=oops', 'occurredAt[after]=yesterday', 'south=80&north=20', 'north=100', 'occurredAt[after]=2026-02-30T12:00:00Z'] as $query) {
            $this->client->request('GET', '/api/earthquakes/map?'.$query);
            self::assertGreaterThanOrEqual(400, $this->client->getResponse()->getStatusCode());
            self::assertLessThan(500, $this->client->getResponse()->getStatusCode());
        }
    }

    public function testMapExcludesResultsOutsideBoundingBox(): void
    {
        $this->client->request('GET', '/api/earthquakes/map?south=0&north=1');
        self::assertResponseIsSuccessful();
        self::assertSame([], json_decode($this->client->getResponse()->getContent(), true)['features']);
    }

    public function testMapUsesUtcDatesAndPreservesUnknownMagnitudes(): void
    {
        $db = static::getContainer()->get(\Doctrine\DBAL\Connection::class);
        $db->executeStatement("UPDATE earthquake SET magnitude = NULL WHERE usgs_id = 'test-2'");
        $query = ['occurredAt' => ['after' => '2026-09-02T05:00:00-07:00', 'before' => '2026-09-02T12:00:00Z']];
        $this->client->request('GET', '/api/earthquakes/map?'.http_build_query($query));
        self::assertResponseIsSuccessful();
        $data = json_decode($this->client->getResponse()->getContent(), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(1, $data['totalItems']);
        self::assertNull($data['features'][0]['properties']['magnitude']);
        self::assertSame('2026-09-02T12:00:00+00:00', $data['features'][0]['properties']['occurredAt']);
        self::assertNull($this->collection()['member'][1]['magnitude']);
    }

    public function testMapCapReportsTotalWithoutSilentlyLosingResults(): void
    {
        $db = static::getContainer()->get(\Doctrine\DBAL\Connection::class);
        if ($db->getDatabasePlatform() instanceof \Doctrine\DBAL\Platforms\SQLitePlatform) {
            self::markTestSkipped('Large catalogue cap is exercised on PostgreSQL in CI.');
        }
        $db->executeStatement("INSERT INTO earthquake (usgs_id, magnitude, place, occurred_at, longitude, latitude, depth) SELECT 'cap-' || n, 3, 'Test', '2026-09-02 12:00:00', -123, 49, 10 FROM generate_series(1, 50001) n");
        $this->client->request('GET', '/api/earthquakes/map');
        self::assertResponseIsSuccessful();
        $data = json_decode($this->client->getResponse()->getContent(), true, flags: JSON_THROW_ON_ERROR);
        self::assertTrue($data['truncated']);
        self::assertSame(50004, $data['totalItems']);
        self::assertCount(50000, $data['features']);
    }
}
