<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261003120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Nullable depths for events USGS has not located vertically';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE earthquake ALTER depth DROP NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->abortIf((int) $this->connection->fetchOne('SELECT COUNT(*) FROM earthquake WHERE depth IS NULL') > 0, 'Cannot restore NOT NULL while unknown depths exist.');
        $this->addSql('ALTER TABLE earthquake ALTER depth SET NOT NULL');
    }
}
