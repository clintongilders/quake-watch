<?php

namespace App\Controller;

use App\Dto\MapFilters;
use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Attribute\MapQueryString;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;

final class EarthquakeMapController extends AbstractController
{
    #[Route('/api/earthquakes/map', name: 'earthquake_map', methods: ['GET'], priority: 10)]
    public function __invoke(Request $request, Connection $db, #[MapQueryString] MapFilters $filters = new MapFilters()): JsonResponse
    {
        $where = [];
        $params = [];
        foreach (['after' => '>=', 'before' => '<='] as $key => $operator) {
            if (isset($filters->occurredAt[$key])) {
                $value = $filters->occurredAt[$key];
                if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/', $value)) {
                    throw new BadRequestHttpException('Dates must be ISO 8601 with a timezone.');
                }
                try {
                    $date = new \DateTimeImmutable($value);
                    if (false !== \DateTimeImmutable::getLastErrors()) {
                        throw new \InvalidArgumentException('Invalid calendar date.');
                    }
                } catch (\Exception) {
                    throw new BadRequestHttpException('Invalid date.');
                }
                $where[] = 'occurred_at '.$operator.' ?';
                $params[] = $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
            }
        }
        if (isset($filters->magnitude['gte'])) {
            $value = $filters->magnitude['gte'];
            if (!is_numeric($value) || !is_finite((float) $value)) {
                throw new BadRequestHttpException('Invalid minimum magnitude.');
            }
            $where[] = 'magnitude >= ?';
            $params[] = (float) $value;
        }
        foreach (['south' => ['latitude', '>='], 'north' => ['latitude', '<='], 'west' => ['longitude', '>='], 'east' => ['longitude', '<=']] as $key => [$column, $operator]) {
            if ($filters->$key !== null) {
                $where[] = $column.' '.$operator.' ?';
                $params[] = $filters->$key;
            }
        }
        if ((null !== $filters->south && null !== $filters->north && $filters->south > $filters->north) || (null !== $filters->west && null !== $filters->east && $filters->west > $filters->east)) {
            throw new BadRequestHttpException('Bounding box must not be reversed; split boxes crossing the antimeridian.');
        }
        $clause = $where ? ' WHERE '.implode(' AND ', $where) : '';
        $rows = $db->fetchAllAssociative('SELECT usgs_id, magnitude, place, occurred_at, longitude, latitude, depth FROM earthquake'.$clause.' ORDER BY occurred_at DESC, usgs_id LIMIT 50001', $params);
        $truncated = count($rows) > 50000;
        $total = $truncated ? (int) $db->fetchOne('SELECT COUNT(*) FROM earthquake'.$clause, $params) : count($rows);
        $features = [];
        foreach (array_slice($rows, 0, 50000) as $row) {
            $features[] = ['type' => 'Feature', 'id' => $row['usgs_id'],
                'geometry' => ['type' => 'Point', 'coordinates' => [(float) $row['longitude'], (float) $row['latitude'], null === $row['depth'] ? null : (float) $row['depth']]],
                'properties' => ['magnitude' => null === $row['magnitude'] ? null : (float) $row['magnitude'], 'place' => $row['place'], 'occurredAt' => (new \DateTimeImmutable($row['occurred_at'], new \DateTimeZone('UTC')))->format(DATE_ATOM)]];
        }
        $payload = ['type' => 'FeatureCollection', 'features' => $features, 'totalItems' => $total, 'truncated' => $truncated];
        $response = new JsonResponse($payload);
        $response->setPublic()->setMaxAge(60)->setSharedMaxAge(60)->setEtag(hash('sha256', $response->getContent()));
        $response->isNotModified($request);

        return $response;
    }
}
