package main

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "runtime"
    "time"
    "bytes"
    "io/ioutil"
    "strings"
)

// buildVersion will be set during build time using -ldflags.
var buildVersion = "development"

// interval defines how often metrics should be collected.  In a full
// implementation this would be configurable via a config file or environment
// variable.  For now it is hard‑coded to 30 seconds.
const interval = 30 * time.Second

// patchInterval defines how often the agent checks for scheduled patches.
// This can be overridden via the PATCH_INTERVAL environment variable (in
// minutes).  The default is 60 minutes.
var patchInterval = 60 * time.Minute

// deviceID holds the unique identifier assigned by the device service
// upon registration.  It is populated by registerDevice and used
// throughout the agent to fetch patch assignments and report status.
var deviceID string

// main is the entry point for the agent.  It initialises any required
// collectors and enters a loop where it gathers metrics and reports them
// to the configured backend.
func main() {
    fmt.Printf("cdot‑RMM agent starting (version %s)\n", buildVersion)

    // Attempt to register this device with the central server.  This
    // registration should complete within one minute of startup to
    // satisfy the onboarding requirement.  Errors are logged but do
    // not stop the agent from running.
    go func() {
        id, err := registerDevice()
        if err != nil {
            fmt.Printf("device registration failed: %v\n", err)
        } else {
            deviceID = id
        }
    }()

    // Override patch interval from environment if provided
    if v := os.Getenv("PATCH_INTERVAL_MINUTES"); v != "" {
        if mins, err := time.ParseDuration(v + "m"); err == nil {
            patchInterval = mins
        }
    }

    // create a cancellable context so that if we implement signals or
    // graceful shutdown later we can stop the collection loop cleanly.
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // In the future we will parse command‑line flags, load a config file and
    // initialise TLS certificates / JWT tokens here.  For now, just start the
    // collection loop.
    ticker := time.NewTicker(interval)
    defer ticker.Stop()
    // Patch check ticker
    patchTicker := time.NewTicker(patchInterval)
    defer patchTicker.Stop()
    for {
        select {
        case <-ticker.C:
            collectAndSendMetrics()
        case <-patchTicker.C:
            // Only perform patch check if deviceID has been set
            if deviceID != "" {
                go checkForPatches(deviceID)
            }
        case <-ctx.Done():
            fmt.Println("agent shutting down")
            return
        }
    }
}

// collectAndSendMetrics performs a single round of metric collection and
// transmits the result to the backend.  Currently this function only prints
// placeholder values; in a future commit it will gather real system data
// using libraries such as gopsutil.
func collectAndSendMetrics() {
    // TODO: Replace with real collection logic (CPU, memory, disk, network)
    timestamp := time.Now().UTC().Format(time.RFC3339)
    fmt.Printf("[%s] Collecting metrics: CPU=0%%, RAM=0%%, Disk=0%%, Net=0kbps\n", timestamp)

    // TODO: Send metrics to backend via gRPC or HTTP
}

// registerDevice sends a registration request to the device service.  It
// collects basic host information such as hostname and operating system.
func registerDevice() (string, error) {
    hostname, _ := os.Hostname()
    deviceInfo := map[string]interface{}{
        "hostname":      hostname,
        "os":            runtime.GOOS,
        "discovered_by": "agent",
    }
    body, err := json.Marshal(deviceInfo)
    if err != nil {
        return "", fmt.Errorf("failed to marshal device info: %w", err)
    }
    url := os.Getenv("DEVICE_SERVICE_URL")
    if url == "" {
        url = "http://localhost:3001/api/devices/register"
    }
    req, err := http.NewRequest("POST", url, bytes.NewReader(body))
    if err != nil {
        return "", fmt.Errorf("failed to create request: %w", err)
    }
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 15 * time.Second}
    resp, err := client.Do(req)
    if err != nil {
        return "", fmt.Errorf("failed to post registration: %w", err)
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 200 && resp.StatusCode < 300 {
        // read body to get device_id
        bodyBytes, _ := ioutil.ReadAll(resp.Body)
        var respData map[string]interface{}
        if err := json.Unmarshal(bodyBytes, &respData); err == nil {
            if id, ok := respData["device_id"].(string); ok {
                fmt.Println("device registered successfully with id", id)
                return id, nil
            }
        }
        fmt.Println("device registered successfully")
        return "", nil
    }
    return "", fmt.Errorf("unexpected response status: %s", resp.Status)
}

// checkForPatches queries the patch service for any approved patches
// scheduled for this device.  It then reports progress as it
// installs each patch (simulated).  This function runs on a
// goroutine and should not block the main loop.
func checkForPatches(id string) {
    // Determine base URL for patch service
    baseURL := os.Getenv("PATCH_SERVICE_URL")
    if baseURL == "" {
        baseURL = "http://localhost:3004/api/patches"
    }
    // Build fetch URL
    fetchURL := strings.TrimRight(baseURL, "/") + "/" + id
    client := &http.Client{Timeout: 20 * time.Second}
    resp, err := client.Get(fetchURL)
    if err != nil {
        fmt.Printf("patch check failed: %v\n", err)
        return
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 200 && resp.StatusCode < 300 {
        body, _ := ioutil.ReadAll(resp.Body)
        var data struct {
            Assignments []struct {
                PatchID    int         `json:"patch_id"`
                ScheduleAt interface{} `json:"schedule_at"`
                Status     string      `json:"status"`
                Name       string      `json:"name"`
                Vendor     string      `json:"vendor"`
                Severity   string      `json:"severity"`
                Description string     `json:"description"`
            } `json:"assignments"`
        }
        if err := json.Unmarshal(body, &data); err == nil {
            for _, asg := range data.Assignments {
                // For each assignment mark as in_progress
                reportPatchStatus(id, asg.PatchID, "in_progress", "")
                fmt.Printf("Installing patch %d (%s)\n", asg.PatchID, asg.Name)
                // Simulate download and install
                time.Sleep(5 * time.Second)
                // After install mark as success
                reportPatchStatus(id, asg.PatchID, "success", "")
                fmt.Printf("Patch %d installed successfully\n", asg.PatchID)
            }
        }
    }
}

// reportPatchStatus posts a status update to the patch service.  It
// ignores errors to avoid retry storms.
func reportPatchStatus(deviceId string, patchId int, status string, errorMsg string) {
    baseURL := os.Getenv("PATCH_SERVICE_URL")
    if baseURL == "" {
        baseURL = "http://localhost:3004/api/patch-status"
    }
    // If the env var is just a base path like http://.../api/patches
    if strings.HasSuffix(baseURL, "/patches") {
        baseURL = strings.TrimSuffix(baseURL, "/patches") + "/patch-status"
    }
    body := map[string]interface{}{
        "device_id":    deviceId,
        "patch_id":     patchId,
        "status":       status,
        "error_message": errorMsg,
    }
    jsonBody, _ := json.Marshal(body)
    req, err := http.NewRequest("POST", baseURL, bytes.NewReader(jsonBody))
    if err != nil {
        fmt.Printf("failed to create patch status request: %v\n", err)
        return
    }
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 15 * time.Second}
    resp, err := client.Do(req)
    if err != nil {
        fmt.Printf("failed to report patch status: %v\n", err)
        return
    }
    resp.Body.Close()
}