/**
 * Test utility for native notifications.
 *
 * Usage in browser console:
 * ```
 * import { testNotification } from '@/lib/notifications/test-notification'
 * testNotification()
 * ```
 */

import { showNativeNotification, notifyTaskComplete, notifyMissionRun, notifyError } from "./native-notify"

/**
 * Test basic notification
 */
export async function testNotification(): Promise<void> {
  await showNativeNotification({
    title: "Test Notification",
    body: "This is a test notification from Nova",
  })
  console.log("✓ Test notification sent")
}

/**
 * Test task completion notification (success)
 */
export async function testTaskSuccess(): Promise<void> {
  await notifyTaskComplete("Test Task", true)
  console.log("✓ Task success notification sent")
}

/**
 * Test task completion notification (failure)
 */
export async function testTaskFailure(): Promise<void> {
  await notifyTaskComplete("Test Task", false)
  console.log("✓ Task failure notification sent")
}

/**
 * Test mission notification (success)
 */
export async function testMissionSuccess(): Promise<void> {
  await notifyMissionRun("Test Mission", true)
  console.log("✓ Mission success notification sent")
}

/**
 * Test mission notification (failure)
 */
export async function testMissionFailure(): Promise<void> {
  await notifyMissionRun("Test Mission", false)
  console.log("✓ Mission failure notification sent")
}

/**
 * Test error notification
 */
export async function testErrorNotification(): Promise<void> {
  await notifyError("This is a test error message")
  console.log("✓ Error notification sent")
}

/**
 * Run all notification tests in sequence
 */
export async function testAllNotifications(): Promise<void> {
  console.log("Running all notification tests...")

  await testNotification()
  await new Promise(resolve => setTimeout(resolve, 500))

  await testTaskSuccess()
  await new Promise(resolve => setTimeout(resolve, 500))

  await testTaskFailure()
  await new Promise(resolve => setTimeout(resolve, 500))

  await testMissionSuccess()
  await new Promise(resolve => setTimeout(resolve, 500))

  await testMissionFailure()
  await new Promise(resolve => setTimeout(resolve, 500))

  await testErrorNotification()

  console.log("✓ All notification tests complete")
}

// Make test functions available globally in dev mode
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).novaTestNotifications = {
    test: testNotification,
    testTaskSuccess,
    testTaskFailure,
    testMissionSuccess,
    testMissionFailure,
    testError: testErrorNotification,
    testAll: testAllNotifications,
  }
  console.log('🧪 Notification tests available: window.novaTestNotifications')
}
