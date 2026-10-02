<?php

namespace App\Service;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

/** Bounded, atomic SQL batches avoid ORM retention and closed EntityManagers. */
final class EarthquakeWriter
{
    public function __construct(private Connection $connection)
    {
    }

    public function write(array $rows): array
    {
        if (!$rows) {
            return [0, 0];
        }
        // Last version wins when the source repeats an ID within one page.
        $unique = [];
        foreach ($rows as $row) {
            $unique[$row[0]] = $row;
        }
        $rows = array_values($unique);

        return $this->connection->transactional(function (Connection $db) use ($rows): array {
            $existing = $db->fetchFirstColumn('SELECT usgs_id FROM earthquake WHERE usgs_id IN (?)', [array_column($rows, 0)], [ArrayParameterType::STRING]);
            $values = implode(', ', array_fill(0, count($rows), '(?, ?, ?, ?, ?, ?, ?)'));
            $db->executeStatement('INSERT INTO earthquake (usgs_id, magnitude, place, occurred_at, longitude, latitude, depth) VALUES '.$values.' ON CONFLICT (usgs_id) DO UPDATE SET magnitude=excluded.magnitude, place=excluded.place, occurred_at=excluded.occurred_at, longitude=excluded.longitude, latitude=excluded.latitude, depth=excluded.depth', array_merge(...$rows));

            return [count($rows) - count($existing), count($existing)];
        });
    }

    public function lastSuccessfulImport(): ?\DateTimeImmutable
    {
        $value = $this->connection->fetchOne("SELECT completed_at FROM import_checkpoint WHERE id = 'live'");

        return $value ? new \DateTimeImmutable($value, new \DateTimeZone('UTC')) : null;
    }

    public function complete(\DateTimeImmutable $started): void
    {
        $this->connection->executeStatement("INSERT INTO import_checkpoint (id, completed_at) VALUES ('live', ?) ON CONFLICT (id) DO UPDATE SET completed_at=excluded.completed_at", [$started->format('Y-m-d H:i:s')]);
    }
}
