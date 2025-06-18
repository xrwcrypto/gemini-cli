settings {
    logfile = "/var/log/lsyncd/lsyncd.log",
    statusFile = "/var/log/lsyncd/lsyncd.status"
}

sync {
    default.rsync,
    source = "/home/node/workspace",
    target = "gcs_bucket_placeholder",
    rsync = {
        binary = "/usr/bin/gcloud",
        _extra = {"storage", "rsync"}
    }
}
