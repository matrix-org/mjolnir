Mjolnir can be run as an appservice, allowing users you trust or on your homeserver to run their own Mjolnir without hosting anything themselves.
This module is currently alpha quality and is subject to rapid changes,
it is not recommended currently and support will be limited.

# Prerequisites

This guide assumes you will be using Docker and that you are able to provide a postgres database for Mjolnir to connect to in application service mode.

# Setup

1. Create a new Matrix room that will act as a policy list for who can use the appservice.
   FIXME: Currently required to be aliased.
   FIXME: Should really be created and managed by the admin room, but waiting for command refactor before doing that. 

2. Decide on a spare local TCP port number to use that will listen for messages from the matrix homeserver. Take care to configure firewalls appropriately. We will call this port `$MATRIX_PORT` in the remaining instructions.

3. Create a `config/config.appservice.yaml` file that can be copied from the example in `src/appservice/config/config.example.yaml`. Your config file needs to be accessible to the docker container later on. To do this you could create a directory called `mjolnir-data` so we can map it to a volume when we launch the container later on.

4. Generate the appservice registration file. This will be used by both the appservice and your homeserver.
   Here, you must specify the direct link the Matrix Homeserver can use to access the appservice, including the Matrix port it will send messages through (if this bridge runs on the same machine you can use `localhost` as the `$HOST` name):
   
   `docker run -rm -v /your/path/to/mjolnir-data:/data matrixdotorg/mjolnir appservice -r -u "http://$HOST:$MATRIX_PORT" -f /data/config/mjolnir-registration.yaml`

5. Step 4 created an application service bot. This will be a bot iwth the mxid specified in `mjolnir-registration.yaml` under `sender_localpart`. You now need to invite it in the access control room that you have created in Step 1.
   
6. Start the application service `docker run -v /your/path/to/mjolnir-data/:/data/ matrixdotorg/mjolnir appservice -c /data/config/config.appservice.yaml -f /data/config/mjolnir-registration.yaml -p $MATRIX_PORT`

7. Copy the `mjolnir-registration.yaml` to your matrix homeserver and refer to it in `homeserver.yaml` like so:
```
  app_service_config_files:
    - "/data/mjolnir-registration.yaml"
```
