FROM php:8.4-fpm-alpine AS runtime
RUN apk add --no-cache icu-dev postgresql-dev oniguruma-dev unzip \
    && docker-php-ext-install pdo_pgsql intl mbstring opcache
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
ENV APP_ENV=prod APP_DEBUG=0
COPY composer.json composer.lock symfony.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --no-interaction --prefer-dist
COPY . .
RUN composer dump-autoload --no-dev --classmap-authoritative --no-scripts \
    && mkdir -p var && chown -R www-data:www-data var
COPY docker/php.ini /usr/local/etc/php/conf.d/quakewatch.ini
USER www-data
CMD ["php-fpm"]
