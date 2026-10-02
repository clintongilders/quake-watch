<?php

namespace App\Tests\Support;

use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Tools\SchemaTool;

trait Database
{
    private function freshDatabase(): EntityManagerInterface
    {
        $manager = static::getContainer()->get(EntityManagerInterface::class);
        $params = $manager->getConnection()->getParams();
        if (($params['driver'] ?? '') === 'pdo_sqlite' && !($params['memory'] ?? false)) {
            throw new \RuntimeException('SQLite tests require an in-memory database.');
        }
        if (($params['driver'] ?? '') !== 'pdo_sqlite' && !str_ends_with($params['dbname'] ?? '', '_test')) {
            throw new \RuntimeException('Tests require an isolated database whose name ends in _test.');
        }
        $metadata = $manager->getMetadataFactory()->getAllMetadata();
        $tool = new SchemaTool($manager);
        $tool->dropSchema($metadata);
        $tool->createSchema($metadata);
        static::getContainer()->get('cache.app')->clear();

        return $manager;
    }
}
