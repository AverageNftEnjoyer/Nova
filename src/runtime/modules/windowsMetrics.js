import { spawn } from "child_process";

const DEFAULT_INTERVAL_MS = 2000;
const MIN_INTERVAL_MS = 2000;
const MAX_BACKOFF_MS = 30000;
const TEMP_RETRY_AFTER_FAILURE_MS = 30000;

function parseInterval(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(MIN_INTERVAL_MS, Math.floor(parsed));
}

function debugLog(message) {
  if (process.env.NOVA_METRICS_DEBUG !== "1") return;
  console.debug(`[Metrics] ${message}`);
}

function runPowerShellJson(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: true,
        shell: false,
      }
    );

    let stdout = "";
    let stderr = "";

    ps.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    ps.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ps.on("error", (error) => {
      reject(error);
    });

    ps.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`PowerShell exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error("PowerShell returned empty output"));
        return;
      }

      try {
        resolve(JSON.parse(trimmed));
      } catch (error) {
        reject(new Error(`Invalid JSON from PowerShell: ${error.message}`));
      }
    });
  });
}

function buildMetricsScript(skipTemperature) {
  return `
$ErrorActionPreference = 'Stop'
$SkipTemp = ${skipTemperature ? "$true" : "$false"}

$result = [ordered]@{
  gpu = [ordered]@{ name = $null; driverVersion = $null; adapterRamMb = $null }
  cpuTemperatureC = $null
  gpuTemperatureC = $null
  pagefile = [ordered]@{ allocatedBaseSizeMb = $null; currentUsageMb = $null; peakUsageMb = $null }
  cpu = [ordered]@{ load = $null; cores = [Environment]::ProcessorCount }
  memory = [ordered]@{ usedGb = $null; totalGb = $null; percent = $null }
  disk = [ordered]@{ usedGb = $null; sizeGb = $null; percent = $null }
  network = [ordered]@{ rxKb = $null; txKb = $null }
  battery = [ordered]@{ percent = 100; charging = $false; hasBattery = $false }
  system = [ordered]@{ manufacturer = $null; model = $null }
}

try {
  $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1 Name, DriverVersion, AdapterRAM
  if ($gpu) {
    $result.gpu.name = $gpu.Name
    $result.gpu.driverVersion = $gpu.DriverVersion
    if ($null -ne $gpu.AdapterRAM) {
      $result.gpu.adapterRamMb = [math]::Round([double]$gpu.AdapterRAM / 1MB)
    }
  }
} catch {}

if (-not $SkipTemp) {
  try {
    $temp = Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace "root/wmi" | Select-Object -First 1 CurrentTemperature
    if ($temp -and $temp.CurrentTemperature) {
      $result.cpuTemperatureC = [math]::Round(($temp.CurrentTemperature / 10) - 273.15, 1)
    }
  } catch {}

  foreach ($ns in @("root/OpenHardwareMonitor", "root/LibreHardwareMonitor")) {
    try {
      $sensors = Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction Stop | Where-Object { $_.SensorType -eq "Temperature" }
      if (-not $result.cpuTemperatureC) {
        $cpuVals = @($sensors | Where-Object {
          $_.Name -like "*CPU*" -or $_.Identifier -like "*cpu*"
        } | ForEach-Object { [double]$_.Value })
        if ($cpuVals.Count -gt 0) {
          $result.cpuTemperatureC = [math]::Round(($cpuVals | Measure-Object -Average).Average, 1)
        }
      }
      if (-not $result.gpuTemperatureC) {
        $gpuVals = @($sensors | Where-Object {
          $_.Name -like "*GPU*" -or $_.Identifier -like "*gpu*"
        } | ForEach-Object { [double]$_.Value })
        if ($gpuVals.Count -gt 0) {
          $result.gpuTemperatureC = [math]::Round(($gpuVals | Measure-Object -Average).Average, 1)
        }
      }
    } catch {}
  }

  if (-not $result.gpuTemperatureC) {
    try {
      if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        $nv = & nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>$null | Select-Object -First 1
        if ($nv -and $nv.ToString().Trim() -match "^[0-9]+(\\.[0-9]+)?$") {
          $result.gpuTemperatureC = [math]::Round([double]$nv.ToString().Trim(), 1)
        }
      }
    } catch {}
  }
}

try {
  $pf = Get-CimInstance Win32_PageFileUsage | Select-Object -First 1 AllocatedBaseSize, CurrentUsage, PeakUsage
  if ($pf) {
    $result.pagefile.allocatedBaseSizeMb = [int]$pf.AllocatedBaseSize
    $result.pagefile.currentUsageMb = [int]$pf.CurrentUsage
    $result.pagefile.peakUsageMb = [int]$pf.PeakUsage
  }
} catch {}

try {
  $cpu = Get-CimInstance Win32_Processor | Select-Object -Property LoadPercentage
  if ($cpu) {
    $vals = @($cpu | ForEach-Object { [double]$_.LoadPercentage })
    if ($vals.Count -gt 0) {
      $result.cpu.load = [math]::Round(($vals | Measure-Object -Average).Average)
    }
  }
} catch {}

try {
  $os = Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory
  if ($os -and $os.TotalVisibleMemorySize -gt 0) {
    $totalKb = [double]$os.TotalVisibleMemorySize
    $freeKb = [double]$os.FreePhysicalMemory
    $usedKb = $totalKb - $freeKb
    $result.memory.totalGb = [math]::Round($totalKb / 1MB, 1)
    $result.memory.usedGb = [math]::Round($usedKb / 1MB, 1)
    $result.memory.percent = [math]::Round(($usedKb / $totalKb) * 100)
  }
} catch {}

try {
  $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object Size, FreeSpace
  if ($disks) {
    $size = 0.0
    $free = 0.0
    foreach ($d in $disks) {
      $size += [double]$d.Size
      $free += [double]$d.FreeSpace
    }
    if ($size -gt 0) {
      $used = $size - $free
      $result.disk.sizeGb = [math]::Round($size / 1GB, 1)
      $result.disk.usedGb = [math]::Round($used / 1GB, 1)
      $result.disk.percent = [math]::Round(($used / $size) * 100)
    }
  }
} catch {}

try {
  $counter = Get-Counter '\\Network Interface(*)\\Bytes Received/sec','\\Network Interface(*)\\Bytes Sent/sec'
  $rx = 0.0
  $tx = 0.0
  foreach ($sample in $counter.CounterSamples) {
    if ($sample.Path -like '*Bytes Received/sec') { $rx += [double]$sample.CookedValue }
    if ($sample.Path -like '*Bytes Sent/sec') { $tx += [double]$sample.CookedValue }
  }
  $result.network.rxKb = [math]::Round($rx / 1KB)
  $result.network.txKb = [math]::Round($tx / 1KB)
} catch {}

try {
  $battery = Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus
  if ($battery) {
    $result.battery.hasBattery = $true
    if ($null -ne $battery.EstimatedChargeRemaining) {
      $result.battery.percent = [int]$battery.EstimatedChargeRemaining
    }
    $result.battery.charging = @('2', '6', '7', '8', '9') -contains ([string]$battery.BatteryStatus)
  }
} catch {}

try {
  $sys = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model
  if ($sys) {
    $result.system.manufacturer = $sys.Manufacturer
    $result.system.model = $sys.Model
  }
} catch {}

$result | ConvertTo-Json -Compress -Depth 6
`;
}

function normalizeMetrics(raw, previousMetrics) {
  const cpuLoad = Number.isFinite(raw?.cpu?.load) ? Number(raw.cpu.load) : (previousMetrics?.cpu?.load ?? 0);
  const cpuTemp = typeof raw?.cpuTemperatureC === "number"
    ? Math.round(raw.cpuTemperatureC)
    : (typeof raw?.temperatureC === "number" ? Math.round(raw.temperatureC) : null);
  const gpuTemp = typeof raw?.gpuTemperatureC === "number" ? Math.round(raw.gpuTemperatureC) : null;
  const estimatedCpuTemp = Math.max(35, Math.min(95, Math.round(38 + (cpuLoad * 0.45))));
  const resolvedCpuTemp = cpuTemp ?? previousMetrics?.cpu?.temp ?? estimatedCpuTemp;
  const estimatedGpuTemp = Math.max(30, Math.min(92, Math.round(34 + (cpuLoad * 0.35))));
  const resolvedGpuTemp = gpuTemp ?? previousMetrics?.gpu?.temp ?? resolvedCpuTemp ?? estimatedGpuTemp;

  return {
    cpu: {
      load: cpuLoad,
      temp: resolvedCpuTemp,
      cores: Number.isFinite(raw?.cpu?.cores) ? raw.cpu.cores : (previousMetrics?.cpu?.cores ?? 0),
    },
    memory: {
      used: Number.isFinite(raw?.memory?.usedGb) ? raw.memory.usedGb : (previousMetrics?.memory?.used ?? 0),
      total: Number.isFinite(raw?.memory?.totalGb) ? raw.memory.totalGb : (previousMetrics?.memory?.total ?? 0),
      percent: Number.isFinite(raw?.memory?.percent) ? raw.memory.percent : (previousMetrics?.memory?.percent ?? 0),
    },
    gpu: {
      name: raw?.gpu?.name || "Unknown",
      temp: resolvedGpuTemp,
      vram: Number.isFinite(raw?.gpu?.adapterRamMb) ? raw.gpu.adapterRamMb : 0,
      utilization: 0,
      driverVersion: raw?.gpu?.driverVersion || null,
    },
    disk: {
      used: Number.isFinite(raw?.disk?.usedGb) ? raw.disk.usedGb : (previousMetrics?.disk?.used ?? 0),
      size: Number.isFinite(raw?.disk?.sizeGb) ? raw.disk.sizeGb : (previousMetrics?.disk?.size ?? 0),
      percent: Number.isFinite(raw?.disk?.percent) ? raw.disk.percent : (previousMetrics?.disk?.percent ?? 0),
    },
    network: {
      rx: Number.isFinite(raw?.network?.rxKb) ? raw.network.rxKb : (previousMetrics?.network?.rx ?? 0),
      tx: Number.isFinite(raw?.network?.txKb) ? raw.network.txKb : (previousMetrics?.network?.tx ?? 0),
    },
    battery: {
      percent: Number.isFinite(raw?.battery?.percent) ? raw.battery.percent : (previousMetrics?.battery?.percent ?? 100),
      charging: Boolean(raw?.battery?.charging),
      hasBattery: Boolean(raw?.battery?.hasBattery),
    },
    system: {
      manufacturer: raw?.system?.manufacturer || previousMetrics?.system?.manufacturer || "Unknown",
      model: raw?.system?.model || previousMetrics?.system?.model || "Unknown",
    },
    windows: {
      gpuController: {
        name: raw?.gpu?.name || null,
        driverVersion: raw?.gpu?.driverVersion || null,
        adapterRamMb: Number.isFinite(raw?.gpu?.adapterRamMb) ? raw.gpu.adapterRamMb : null,
      },
      temperatureC: typeof raw?.cpuTemperatureC === "number"
        ? raw.cpuTemperatureC
        : (typeof raw?.temperatureC === "number" ? raw.temperatureC : null),
      cpuTemperatureC: typeof raw?.cpuTemperatureC === "number" ? raw.cpuTemperatureC : null,
      gpuTemperatureC: typeof raw?.gpuTemperatureC === "number" ? raw.gpuTemperatureC : null,
      cpuTemperatureEstimated: cpuTemp === null,
      gpuTemperatureEstimated: gpuTemp === null,
      pagefile: {
        allocatedBaseSizeMb: Number.isFinite(raw?.pagefile?.allocatedBaseSizeMb) ? raw.pagefile.allocatedBaseSizeMb : null,
        currentUsageMb: Number.isFinite(raw?.pagefile?.currentUsageMb) ? raw.pagefile.currentUsageMb : null,
        peakUsageMb: Number.isFinite(raw?.pagefile?.peakUsageMb) ? raw.pagefile.peakUsageMb : null,
      },
    },
  };
}

class WindowsMetricsPoller {
  constructor(options = {}) {
    this.intervalMs = parseInterval(options.intervalMs, DEFAULT_INTERVAL_MS);
    this.inFlight = false;
    this.lastGoodValue = null;
    this.failureCount = 0;
    this.nextPollAt = 0;
    this.temperatureRetryAt = 0;
    this.lastDisabledLogAt = 0;
  }

  isDisabled() {
    return process.env.NOVA_METRICS_DISABLED === "1";
  }

  async getSystemMetrics() {
    if (this.isDisabled()) {
      const now = Date.now();
      if (now - this.lastDisabledLogAt > 30000) {
        this.lastDisabledLogAt = now;
        debugLog("Polling disabled via NOVA_METRICS_DISABLED=1");
      }
      return null;
    }

    const now = Date.now();
    if (!this.lastGoodValue) {
      await this.pollNow();
      return this.lastGoodValue;
    }

    if (!this.inFlight && now >= this.nextPollAt) {
      void this.pollNow();
    }

    return this.lastGoodValue;
  }

  async pollNow() {
    if (this.inFlight) {
      return this.lastGoodValue;
    }

    this.inFlight = true;

    try {
      const skipTemperature = Date.now() < this.temperatureRetryAt;
      const raw = await runPowerShellJson(buildMetricsScript(skipTemperature));
      const metrics = normalizeMetrics(raw, this.lastGoodValue);

      if (metrics.windows.cpuTemperatureC === null && metrics.windows.gpuTemperatureC === null && !skipTemperature) {
        this.temperatureRetryAt = Date.now() + TEMP_RETRY_AFTER_FAILURE_MS;
      }

      this.lastGoodValue = metrics;
      this.failureCount = 0;
      this.nextPollAt = Date.now() + this.intervalMs;
      return this.lastGoodValue;
    } catch (error) {
      this.failureCount += 1;
      const backoffMs = Math.min(
        MAX_BACKOFF_MS,
        this.intervalMs * Math.pow(2, Math.max(0, this.failureCount - 1))
      );
      this.nextPollAt = Date.now() + backoffMs;

      debugLog(`Poll failed (${this.failureCount}), backoff=${backoffMs}ms: ${error.message}`);
      return this.lastGoodValue;
    } finally {
      this.inFlight = false;
    }
  }
}

const singleton = new WindowsMetricsPoller({
  intervalMs: parseInterval(process.env.NOVA_METRICS_INTERVAL_MS, DEFAULT_INTERVAL_MS),
});

export function getSystemMetrics() {
  return singleton.getSystemMetrics();
}

export function getWindowsMetricsPoller() {
  return singleton;
}

export function getWindowsMetricsPowerShellScript(skipTemperature = false) {
  return buildMetricsScript(skipTemperature);
}
