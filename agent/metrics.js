import si from "systeminformation";

/**
 * Get current system metrics
 */
export async function getSystemMetrics() {
  try {
    const [cpu, cpuTemp, mem, graphics, networkStats, fsSize, battery, system] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature(),
      si.mem(),
      si.graphics(),
      si.networkStats(),
      si.fsSize(),
      si.battery(),
      si.system(),
    ]);

    // Get GPU info
    const gpu = graphics.controllers?.[0] || {};

    // Get primary disk
    const disk = fsSize?.[0] || {};

    // Get network throughput
    const net = networkStats?.[0] || {};

    return {
      cpu: {
        load: Math.round(cpu.currentLoad || 0),
        temp: Math.round(cpuTemp.main || 0),
        cores: cpu.cpus?.length || 0,
      },
      memory: {
        used: Math.round((mem.used / (1024 * 1024 * 1024)) * 10) / 10, // GB
        total: Math.round((mem.total / (1024 * 1024 * 1024)) * 10) / 10,
        percent: Math.round((mem.used / mem.total) * 100),
      },
      gpu: {
        name: gpu.model || "Unknown",
        temp: gpu.temperatureGpu || 0,
        vram: gpu.vram || 0,
        utilization: gpu.utilizationGpu || 0,
      },
      disk: {
        used: Math.round((disk.used / (1024 * 1024 * 1024)) * 10) / 10,
        size: Math.round((disk.size / (1024 * 1024 * 1024)) * 10) / 10,
        percent: Math.round(disk.use || 0),
      },
      network: {
        rx: Math.round((net.rx_sec || 0) / 1024), // KB/s
        tx: Math.round((net.tx_sec || 0) / 1024),
      },
      battery: {
        percent: battery.percent || 100,
        charging: battery.isCharging || false,
        hasBattery: battery.hasBattery || false,
      },
      system: {
        manufacturer: system.manufacturer || "Unknown",
        model: system.model || "Unknown",
      },
    };
  } catch (error) {
    console.error("[Metrics] Error:", error.message);
    return null;
  }
}

/**
 * Start broadcasting system metrics at interval
 */
export function startMetricsBroadcast(broadcast, intervalMs = 2000) {
  // Send initial metrics
  sendMetrics(broadcast);

  // Then update every interval
  const timer = setInterval(() => sendMetrics(broadcast), intervalMs);

  return () => clearInterval(timer);
}

async function sendMetrics(broadcast) {
  const metrics = await getSystemMetrics();
  if (metrics) {
    broadcast({
      type: "system_metrics",
      metrics,
      ts: Date.now(),
    });
  }
}
