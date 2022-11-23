Mjolnir is available on the Docker Hub as [`matrixdotorg/mjolnir`](https://hub.docker.com/r/matrixdotorg/mjolnir).

Using docker, mjolnir can be setup and ran in either of two ways;
- Docker Run
- Docker Compose

Docker run will fire off a single-use container that is tied to your terminal's lifetime. (if you close the terminal, you shut down the bot)

Docker Compose can manage containers in the background, read a "compose" file, and automatically
recreate/restart relevant containers (upon `docker-compose up -d`) if they diverge from the file. It
can also easily read logs and manage the lifecycle of these containers. (start/stop/restart)

# Prerequisites

Before any other steps, a configuration file must be prepared.

Please go through [the sample configuration file's documentation](../config/default.yaml), download it, and rename it `production.yaml`.

You should go through and edit values to your liking, afterwards, pick a directory that'll be the root of all your mjolnir data files (i.e. `./mjolnir` from the home directory on your server), create a new directory called `config`, place the file there.

In short, please make sure that the mjolnir configuration exists under `./config/production.yaml` relative to the directory you've chosen, else mjolnir will not recognise it.

# Docker Run

Run the following command in your terminal, replace `./mjolnir` with the root directory of your config, if it is in another spot.

```bash
docker run --rm -it -v ./mjolnir:/data matrixdotorg/mjolnir:latest bot --mjolnir-config /data/config/production.yaml
```

# Docker Compose

Take the following file, and copy-paste it in `docker-compose.yml`;

```yaml
version: "3.3"

services:
  mjolnir:
    image: matrixdotorg/mjolnir:latest
    restart: unless-stopped
    volumes:
      - ./mjolnir:/data
```

If you have pantalaimon installed, you can include it in this compose file as follows;

```yaml
version: "3.3"

services:
  pantalaimon:
    build: ./pantalaimon
    container_name: pantalaimon
    restart: unless-stopped
    volumes:
      - ./pantalaimon_data:/data
    ports:
      - 8008:8008
  mjolnir:
    image: matrixdotorg/mjolnir:latest
    restart: unless-stopped
    volumes:
      - ./mjolnir:/data
```

**Note**: At the moment, pantalaimon does not have a Docker Hub image, so `./pantalaimon` needs to be the checked-out github repository, which you can do with `git clone https://github.com/matrix-org/pantalaimon`.

**Note**: In this configuration, you can access pantalaimon by using `pantalaimon` as a hostname, e.g. `http://pantalaimon:8080/` as `homeserverUrl`.

Replace `./mjolnir` (and optionally `./pantalaimon_data`) with the correct directories.

Then call `docker-compose up -d` while in the same directory as `docker-compose.yml` to pull, create, and start the containers.

- Use `docker-compose stop` to stop all containers, or `docker-compose stop mjolnir` to stop only the `mjolnir` container.
- Use `docker-compose restart mjolnir` to restart the mjolnir container, omit to restart all containers.
- Use `docker-compose down` to stop and remove all containers.
- Use `docker-compose logs` to display container logs, append `-f` to follow the logs in your terminal, append `--tail 100` to only show the latest 100 entries.