<?php

namespace App\Entity;

use ApiPlatform\Doctrine\Orm\Filter\ComparisonFilter;
use ApiPlatform\Doctrine\Orm\Filter\DateFilter;
use ApiPlatform\Doctrine\Orm\Filter\ExactFilter;
use ApiPlatform\Doctrine\Orm\Filter\SortFilter;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\QueryParameter;
use App\Repository\EarthquakeRepository;
use Doctrine\ORM\Mapping as ORM;

#[ApiResource(
    operations: [
        new Get(),
        new GetCollection(),
    ],
    order: [
        'occurredAt' => 'DESC',
    ],
    parameters: [
        'magnitude' => new QueryParameter(
            filter: new ComparisonFilter(new ExactFilter()),
            property: 'magnitude',
        ),
        'depth' => new QueryParameter(
            filter: new ComparisonFilter(new ExactFilter()),
            property: 'depth',
        ),
        'occurredAt' => new QueryParameter(
            filter: new DateFilter(),
            property: 'occurredAt',
        ),
        'sortOccurredAt' => new QueryParameter(
            filter: new SortFilter(),
            property: 'occurredAt',
        ),
        'sortDepth' => new QueryParameter(
            filter: new SortFilter(),
            property: 'depth',
        ),
        'sortMagnitude' => new QueryParameter(
            filter: new SortFilter(),
            property: 'magnitude',
        ),
    ],
)]
#[ORM\Index(name: 'earthquake_time_magnitude_idx', columns: ['occurred_at', 'magnitude'])]
#[ORM\Index(name: 'earthquake_magnitude_idx', columns: ['magnitude'])]
#[ORM\Index(name: 'earthquake_depth_idx', columns: ['depth'])]
#[ORM\Entity(repositoryClass: EarthquakeRepository::class)]
class Earthquake
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 255, unique: true)]
    private string $usgsId;

    #[ORM\Column(nullable: true)]
    private ?float $magnitude = null;

    #[ORM\Column(length: 255)]
    private string $place;

    #[ORM\Column]
    private \DateTimeImmutable $occurredAt;

    #[ORM\Column]
    private float $latitude;

    #[ORM\Column]
    private float $longitude;

    #[ORM\Column]
    private float $depth;

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getUsgsId(): string
    {
        return $this->usgsId;
    }

    public function setUsgsId(string $usgsId): static
    {
        $this->usgsId = $usgsId;

        return $this;
    }

    public function getMagnitude(): ?float
    {
        return $this->magnitude;
    }

    public function setMagnitude(?float $magnitude): static
    {
        $this->magnitude = $magnitude;

        return $this;
    }

    public function getPlace(): string
    {
        return $this->place;
    }

    public function setPlace(string $place): static
    {
        $this->place = $place;

        return $this;
    }

    public function getOccurredAt(): \DateTimeImmutable
    {
        return $this->occurredAt;
    }

    public function setOccurredAt(\DateTimeImmutable $occurredAt): static
    {
        $this->occurredAt = $occurredAt;

        return $this;
    }

    public function getLatitude(): float
    {
        return $this->latitude;
    }

    public function setLatitude(float $latitude): static
    {
        $this->latitude = $latitude;

        return $this;
    }

    public function getLongitude(): float
    {
        return $this->longitude;
    }

    public function setLongitude(float $longitude): static
    {
        $this->longitude = $longitude;

        return $this;
    }

    public function getDepth(): float
    {
        return $this->depth;
    }

    public function setDepth(float $depth): static
    {
        $this->depth = $depth;

        return $this;
    }
}
