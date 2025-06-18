settings {
    logfile    = "stdout",
    statusFile = "/var/log/lsyncd/lsyncd.status",
    nodaemon   = true
}

-- Define a reusable function for the gcloud rsync command.
local function gcloud_rsync(inlet)
    local source = inlet.source
    local target = inlet.target
    local cmd = "/usr/bin/gcloud storage rsync --recursive --delete-unmatched-destination-objects " .. source .. " " .. target
    return spawn(inlet, "/bin/bash", "-c", cmd)
end

sync {
    default.script,
    source = "/home/node/workspace",
    target = "gcs_bucket_placeholder",
    
    -- onStartup, run the initial sync.
    onStartup = gcloud_rsync,

    -- Assign the same function to each file change event.
    onCreate = gcloud_rsync,
    onModify = gcloud_rsync,
    onMove = gcloud_rsync,
    onDelete = gcloud_rsync,

    -- Delay in seconds to aggregate events.
    delay = 5
}