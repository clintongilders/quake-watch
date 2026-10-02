<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class ImportCheckpoint
{
    #[ORM\Id]
    #[ORM\Column(length: 20)]
    public string $id;

    #[ORM\Column]
    public \DateTimeImmutable $completedAt;
}
