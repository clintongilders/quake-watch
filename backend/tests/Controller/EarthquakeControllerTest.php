<?php
namespace App\Tests\Controller;

use App\Entity\Earthquake;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Tools\SchemaTool;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** Uses a fresh in-memory database, never development data. */
final class EarthquakeControllerTest extends WebTestCase
{
    private KernelBrowser $client;
    private array $previousUrl;

    protected function setUp(): void
    {
        parent::setUp();
        $this->previousUrl = [$_ENV['DATABASE_URL'] ?? null, $_SERVER['DATABASE_URL'] ?? null, getenv('DATABASE_URL')];
        $_ENV['DATABASE_URL'] = $_SERVER['DATABASE_URL'] = 'sqlite:///:memory:';
        putenv('DATABASE_URL=sqlite:///:memory:');
        $this->client = static::createClient();
        $this->client->disableReboot();
        $manager = static::getContainer()->get(EntityManagerInterface::class);
        (new SchemaTool($manager))->createSchema([$manager->getClassMetadata(Earthquake::class)]);
        foreach ([[1, 2.0, 30.0], [2, 5.0, 10.0], [3, 3.0, 20.0]] as [$day, $magnitude, $depth]) {
            $manager->persist((new Earthquake())->setUsgsId('test-'.$day)->setPlace('Test '.$day)
                ->setMagnitude($magnitude)->setDepth($depth)->setLatitude(49)->setLongitude(-123)
                ->setOccurredAt(new \DateTimeImmutable('2026-09-0'.$day.'T12:00:00Z')));
        }
        $manager->flush();
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        foreach (['_ENV', '_SERVER'] as $index => $name) {
            if ($this->previousUrl[$index] === null) unset($GLOBALS[$name]['DATABASE_URL']);
            else $GLOBALS[$name]['DATABASE_URL'] = $this->previousUrl[$index];
        }
        putenv($this->previousUrl[2] === false ? 'DATABASE_URL' : 'DATABASE_URL='.$this->previousUrl[2]);
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
}
