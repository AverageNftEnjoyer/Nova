#!/usr/bin/env node

/**
 * Task Context Groups - Manual Test Script
 *
 * This script demonstrates the task context functionality:
 * 1. Create a context
 * 2. Create tasks in that context
 * 3. Verify context summary generation
 */

import { createContext, listContexts, getContextTaskIds, generateContextSummary } from '../hud/lib/agents/context-manager.ts'
import { createTask, listTasks } from '../hud/lib/agents/task-store.ts'

const TEST_USER = 'test-user-12345'

async function main() {
  console.log('🧪 Testing Task Context Groups\n')

  // Clean start
  console.log('1️⃣  Creating context "auth-feature"...')
  let context
  try {
    context = await createContext(TEST_USER, 'auth-feature')
    console.log(`   ✅ Created: ${context.name} (${context.id})\n`)
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`)
    return
  }

  // Create first task
  console.log('2️⃣  Creating first task in context...')
  try {
    const task1 = await createTask(TEST_USER, {
      name: 'Add login form',
      prompt: 'Create a login form component with email and password fields',
      agent: 'claude',
      model: 'sonnet-4.5',
      contextId: context.id
    })
    console.log(`   ✅ Task created: "${task1.name}" (${task1.id})`)
    console.log(`   📌 Context: ${task1.contextId}\n`)
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`)
    return
  }

  // List contexts
  console.log('3️⃣  Listing all contexts...')
  try {
    const contexts = await listContexts(TEST_USER)
    console.log(`   ✅ Found ${contexts.length} context(s):`)
    contexts.forEach(ctx => {
      console.log(`      - ${ctx.name} (${ctx.id})`)
    })
    console.log()
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`)
    return
  }

  // Get context tasks
  console.log('4️⃣  Getting tasks in context...')
  try {
    const taskIds = await getContextTaskIds(TEST_USER, context.id)
    console.log(`   ✅ Found ${taskIds.length} task(s) in context`)
    console.log()
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`)
    return
  }

  // Generate summary (simulating second task creation)
  console.log('5️⃣  Generating context summary...')
  try {
    const allTasks = await listTasks(TEST_USER)
    const summary = await generateContextSummary(TEST_USER, context.id, allTasks)
    console.log('   ✅ Summary generated:')
    console.log('   ┌─────────────────────────────────────────')
    summary.split('\n').forEach(line => {
      console.log(`   │ ${line}`)
    })
    console.log('   └─────────────────────────────────────────')
    console.log()
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`)
    return
  }

  console.log('✨ All tests passed!\n')
  console.log('📋 Summary:')
  console.log('   - Context creation works')
  console.log('   - Task assignment to context works')
  console.log('   - Context listing works')
  console.log('   - Context summary generation works')
  console.log('\n🔖 Bookmark icon should appear on task cards in the UI')
  console.log('📝 New task prompts in this context will include the summary')
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
