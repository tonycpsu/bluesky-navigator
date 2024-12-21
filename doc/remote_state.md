Remote State Sync (beta)
========================

Bluesky Navigator supports syncing read/unread article state to a remote server,
and potentially between multiple browsers. Right now,
[SurrealDB](https://surrealdb.com/) is the only service supported, and it takes
a bit of work to set it up, so it's not for the faint of heart. (More mainstream
cloud services may be supported in the future, but this is the one I was able to
get working given the limitations of the Userscript environment).

Instructions for SurrealDB setup vary, but I used [these Docker
instructions](https://surrealdb.com/docs/surrealdb/installation/running/docker),
with an Nginx reverse proxy on my web host.

Once you have a working SurrealDB setup, you can enter a JSON object like the
following in the `State Sync Configuration (JSON)` field in the configuration
dialog (accessible by clicking the gear icon in the bottom right corner of the
page or using the `Meta/Alt+.` keyboard shortcut):

```json
{
    "url": "https://surrealdb.example.org/sql",
    "namespace": "bluesky_navigator",
    "database": "state",
    "username": "example",
    "password": "trustno1"
}
```

To enable state sync, check the `Enable State Sync` box in the config, then
click the `Save` button. Reload, and if all goes well, the script state should
be saved to the remote database.
