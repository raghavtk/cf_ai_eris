import { describe, it, expect, beforeAll } from 'vitest'
import { taskService } from './taskService'

// Mark as integration test - skip in CI unless worker is running
describe.skip('taskService integration', () => {
  let createdTaskId: string

  beforeAll(async () => {
    // Ensure worker is running on localhost:8787
    try {
      await fetch('http://localhost:8787/')
    } catch {
      throw new Error('Worker not running. Start with: cd worker && wrangler dev')
    }
  })

  it('should create a task', async () => {
    const task = await taskService.create({
      title: 'Integration Test Task',
      description: 'Created by integration test',
      priority: 'medium',
      status: 'pending',
      category: 'work',
      subcategory: 'Projects',
      due_date: '2024-12-31',
      estimated_duration: 120,
      note: 'Integration test note',
    })

    expect(task.id).toBeDefined()
    expect(task.title).toBe('Integration Test Task')
    createdTaskId = task.id
  })

  it('should fetch all tasks', async () => {
    const tasks = await taskService.getAll()
    expect(Array.isArray(tasks)).toBe(true)
    expect(tasks.length).toBeGreaterThan(0)
  })

  it('should update a task', async () => {
    const updated = await taskService.update(createdTaskId, {
      title: 'Updated Integration Test',
      priority: 'high',
    })

    expect(updated.title).toBe('Updated Integration Test')
    expect(updated.priority).toBe('high')
  })

  it('should delete a task', async () => {
    await taskService.delete(createdTaskId)
    
    try {
      await taskService.getById(createdTaskId)
      throw new Error('Should have thrown 404')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('not found')
    }
  })
})
