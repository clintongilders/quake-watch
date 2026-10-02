<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261002190000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Nullable magnitudes, query indexes, and resumable import checkpoints';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE earthquake ALTER magnitude DROP NOT NULL');
        $this->addSql('CREATE INDEX earthquake_time_magnitude_idx ON earthquake (occurred_at, magnitude)');
        $this->addSql('CREATE INDEX earthquake_magnitude_idx ON earthquake (magnitude)');
        $this->addSql('CREATE INDEX earthquake_depth_idx ON earthquake (depth)');
        $this->addSql('CREATE TABLE import_checkpoint (id VARCHAR(20) NOT NULL PRIMARY KEY, completed_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL)');
    }

    public function down(Schema $schema): void
    {
        $this->abortIf((int) $this->connection->fetchOne('SELECT COUNT(*) FROM earthquake WHERE magnitude IS NULL') > 0, 'Cannot restore NOT NULL while unknown magnitudes exist.');
        $this->addSql('ALTER TABLE earthquake ALTER magnitude SET NOT NULL');
        $this->addSql('DROP INDEX earthquake_time_magnitude_idx');
        $this->addSql('DROP INDEX earthquake_magnitude_idx');
        $this->addSql('DROP INDEX earthquake_depth_idx');
        $this->addSql('DROP TABLE import_checkpoint');
    }
}
