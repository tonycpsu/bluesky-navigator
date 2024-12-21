Remote State Sync (beta)
========================

Bluesky Navigator supports syncing read/unread article state to a remote server,
and potentially between multiple browsers.

Right now, [SurrealDB](https://surrealdb.com/) is the only supported cloud
service.

## Cloud Setup

### Option 1: Surreal Cloud

The easiest way to get setup is via [Surreal
Cloud](https://surrealist.app/cloud), which is (as of this writing) offering
free cloud-hosted SurrealDB instances. Steps to get connected are as follows:

1. Create a Surreal Cloud account.
2. [Create a free instance](https://surrealist.app/cloud/provision) (this takes
   a few minutes).
3. Once the instance is created, you'll need to create a system account to
   connect to the database:
   1. [open the authentication settings
   page](https://surrealist.app/authentication)
   2. Click the `+` icon, then select "New system user".
   3. Enter a username and a secure password. For these instructions, we'll use
      `example` and `trustno1`.
   4. Under "Select a role" check the "Editor" and "Viewer" boxes.
   5. Click the "Create user" button.
4. You will need the instance URL to configure the script. To get it, open the
   instances page, then click the `⋮` overflow menu next to your instance, then
   click "Copy hostname". The URL for your instance will be
   `https://{hostmame}`, e.g.
   `https://instance-name-029ujemablqrs4d0un2jktj7e4.aws-use1.surreal.cloud`.

### Option 2: SurrealDB Self-Hosted

If you don't want to be dependent on a third-party cloud service, you can host
SurrealDB on your own hosting infrastructure. This option takes a bit of work to
set it up, so it's not for the faint of heart.

Instructions for SurrealDB setup vary, but I used [these Docker
instructions](https://surrealdb.com/docs/surrealdb/installation/running/docker),
with an Nginx reverse proxy on my web host.

## Configuring the Remote State Connection

Once you have a working SurrealDB setup, enter a JSON object like the
following in the `State Sync Configuration (JSON)` field in the configuration
dialog (accessible by clicking the gear icon in the bottom right corner of the
page or using the `Meta/Alt+.` keyboard shortcut):

```json
{
    "url": "https://instance-name-029ujemablqrs4d0un2jktj7e4.aws-use1.surreal.cloud",
    "username": "example",
    "password": "trustno1"
}
```

To enable state sync, check the `Enable State Sync` box in the config, then
click the `Save` button. Reload, and if all goes well, the script state should
be loaded from and saved to the remote database.
