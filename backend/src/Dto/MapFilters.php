<?php

namespace App\Dto;

use Symfony\Component\Validator\Constraints as Assert;

final class MapFilters
{
    public function __construct(
        public array $magnitude = [],
        public array $occurredAt = [],
        #[Assert\Range(min: -90, max: 90)] public ?float $south = null,
        #[Assert\Range(min: -90, max: 90)] public ?float $north = null,
        #[Assert\Range(min: -180, max: 180)] public ?float $west = null,
        #[Assert\Range(min: -180, max: 180)] public ?float $east = null,
    ) {
    }
}
