'use strict';

// Chromium's WebGPU/GL interop can initialize Wayland Vulkan even when Vulkan
// compositing is disabled. Prefer GLES, without changing explicit GPU choices.
function configureWaylandGpu({ platform, env, commandLine }) {
  if (platform !== 'linux' || !commandLine) return false;
  const ozone = commandLine.getSwitchValue('ozone-platform');
  const hint = commandLine.getSwitchValue('ozone-platform-hint');
  const wayland = ozone ? ozone === 'wayland' : hint === 'x11' ? false : hint === 'wayland' || env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland';
  if (!wayland || commandLine.hasSwitch('use-webgpu-adapter') || commandLine.hasSwitch('use-vulkan') ||
      commandLine.getSwitchValue('use-angle').toLowerCase().includes('vulkan') ||
      /(?:^|,)\s*Vulkan(?:[<:,]|$)/i.test(commandLine.getSwitchValue('enable-features'))) return false;
  commandLine.appendSwitch('use-webgpu-adapter', 'opengles');
  return true;
}
module.exports = { configureWaylandGpu };
