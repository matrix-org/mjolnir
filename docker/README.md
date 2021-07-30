## Testing mjolnir with docker

At the moment a test environment for mjolnir can be setup by running
`./mjolnir_testing.sh` from the parent directory. This script  will use
the `docker-compose.yaml` in the parent directory.

This sets up synapse container with a user for mjolnir to use.
The container for mjolnir, creates and joins the moderation room
which has to be specified with an alias in the config under `managementRoom`.
Eventually this setup should be moved to a testing module.
