function fileUrlToPath(fileUrl) {
  try {
    const pathname = decodeURIComponent(new URL(fileUrl).pathname)
    if (process.platform === "win32" && /^\/[a-zA-Z]:/.test(pathname)) return pathname.slice(1)
    return pathname
  } catch {
    return ""
  }
}

module.exports = { fileUrlToPath }
