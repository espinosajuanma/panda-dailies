const test = require('node:test');
const assert = require('node:assert/strict');
const TaskUtils = require('../src/task-utils.js');

const reviewedTask = (status, feedback, reviewerId = 'speaker-1') => ({
    id: `review-${status}-${feedback || 'missing'}`,
    status,
    roles: ['Reviewer'],
    reviewFeedbacks: feedback === undefined ? [] : [{ reviewer: { id: reviewerId }, feedback }],
});

test('Done includes completed assignee tasks and reviewed tasks with my final review', () => {
    const tasks = [
        { id: 'done-assigned', status: 'completed', roles: ['Assignee'] },
        reviewedTask('inReview', 'approved'),
        reviewedTask('inReview', 'changesRequested'),
    ];

    assert.deepEqual(
        TaskUtils.filterAndSortTasks(tasks, 'Done', 'speaker-1').map(task => task.id),
        ['done-assigned', 'review-inReview-approved', 'review-inReview-changesRequested'],
    );
});

test('Done excludes reviewer tasks outside inReview and feedback from another reviewer', () => {
    const tasks = [
        reviewedTask('completed', 'approved'),
        reviewedTask('inReview', 'approved', 'someone-else'),
        reviewedTask('inReview', 'pending'),
    ];

    assert.deepEqual(TaskUtils.filterAndSortTasks(tasks, 'Done', 'speaker-1'), []);
});

test('Current only includes in-progress assignee tasks', () => {
    const tasks = [
        { id: 'current', status: 'inProgress', roles: ['Assignee'] },
        { id: 'reviewer-only', status: 'inProgress', roles: ['Reviewer'] },
        { id: 'wrong-status', status: 'toDo', roles: ['Assignee'] },
    ];

    assert.deepEqual(TaskUtils.filterAndSortTasks(tasks, 'Current', 'speaker-1').map(task => task.id), ['current']);
});

test('Remaining includes assignee To Do and reviewer In Review with pending feedback', () => {
    const tasks = [
        { id: 'assigned-todo', status: 'toDo', roles: ['Assignee'] },
        reviewedTask('inReview', 'pending'),
        reviewedTask('inReview', undefined),
        reviewedTask('inReview', 'approved'),
        reviewedTask('inProgress', 'pending'),
    ];

    assert.deepEqual(
        TaskUtils.filterAndSortTasks(tasks, 'Remaining', 'speaker-1').map(task => task.id),
        ['review-inReview-missing', 'review-inReview-pending', 'assigned-todo'],
    );
});

test('reviewer outcomes show Pending review, Approved, or Changes requested for the active reviewer', () => {
    assert.equal(TaskUtils.reviewerFeedbackLabel(reviewedTask('inReview', 'pending'), 'speaker-1'), 'Pending review');
    assert.equal(TaskUtils.reviewerFeedbackLabel(reviewedTask('inReview', 'approved'), 'speaker-1'), 'Approved');
    assert.equal(TaskUtils.reviewerFeedbackLabel(reviewedTask('inReview', 'changesRequested'), 'speaker-1'), 'Changes requested');
    assert.equal(TaskUtils.reviewerFeedbackLabel(reviewedTask('inReview', 'approved', 'another-reviewer'), 'speaker-1'), 'Pending review');
    assert.equal(TaskUtils.reviewerFeedbackLabel({ roles: ['Assignee'], reviewFeedbacks: [] }, 'speaker-1'), '');
});

test('a task with both roles appears once when either role matches', () => {
    const [task] = TaskUtils.mergeTasks(
        [{ id: 'shared', number: 12, title: 'Shared task', status: 'inReview', reviewFeedbacks: [{ reviewer: { id: 'speaker-1' }, feedback: 'pending' }] }],
        [{ id: 'shared', number: 12, title: 'Shared task', status: 'inReview', reviewFeedbacks: [{ reviewer: { id: 'speaker-1' }, feedback: 'pending' }] }],
    );

    assert.deepEqual(task.roles, ['Assignee', 'Reviewer']);
    assert.equal(TaskUtils.filterAndSortTasks([task], 'Remaining', 'speaker-1').length, 1);
    assert.equal(TaskUtils.filterAndSortTasks([task], 'All', 'speaker-1').length, 1);
});

test('merging keeps task content and avoids duplicate feedback records', () => {
    const [task] = TaskUtils.mergeTasks(
        [{ id: 'shared', title: 'A title', description: 'Details', notes: ['One'], reviewFeedbacks: [{ reviewer: { id: 'r1' }, feedback: 'approved' }] }],
        [{ id: 'shared', reviewFeedbacks: [{ reviewer: { id: 'r1' }, feedback: 'approved' }] }],
    );

    assert.equal(task.title, 'A title');
    assert.equal(task.description, 'Details');
    assert.deepEqual(task.taskNotes, ['One']);
    assert.equal(task.reviewFeedbacks.length, 1);
});

test('sorts by view status order, task number, then stable title', () => {
    const tasks = [
        { id: 'todo-9', number: 9, status: 'toDo' },
        { id: 'review-2', number: 2, status: 'inReview' },
        { id: 'todo-1', number: 1, status: 'toDo' },
    ];

    assert.deepEqual(
        TaskUtils.sortTasks(tasks, 'Remaining').map(task => task.id),
        ['review-2', 'todo-1', 'todo-9'],
    );
});

test('All uses the documented To Do, In Progress, In Review, Completed ordering', () => {
    const tasks = [
        { id: 'completed', status: 'completed', roles: ['Assignee'] },
        { id: 'in-review', status: 'inReview', roles: ['Reviewer'] },
        { id: 'in-progress', status: 'inProgress', roles: ['Assignee'] },
        { id: 'to-do', status: 'toDo', roles: ['Assignee'] },
    ];

    assert.deepEqual(
        TaskUtils.filterAndSortTasks(tasks, 'All', 'speaker-1').map(task => task.id),
        ['to-do', 'in-progress', 'in-review', 'completed'],
    );
});

test('task details normalize text, note arrays, and common note wrappers', () => {
    assert.deepEqual(
        TaskUtils.extractTaskDetails({ item: { description: 'Task description', notes: { items: [{ text: 'First note' }, 'Second note'] } } }),
        { description: 'Task description', notes: ['First note', 'Second note'] },
    );
    assert.deepEqual(TaskUtils.extractTaskDetails(null, { description: 'List description', taskNotes: 'List note' }), {
        description: 'List description',
        notes: ['List note'],
    });
});

test('task HTML is sanitized before rendering and safely escaped if the sanitizer is unavailable', () => {
    const unsafeHtml = '<p onclick="run()">Hello<script>alert(1)</script></p>';
    let receivedOptions;
    const sanitized = TaskUtils.sanitizeTaskHtml(unsafeHtml, {
        sanitize(value, options) {
            receivedOptions = options;
            return '<p>Hello</p>';
        },
    });

    assert.equal(sanitized, '<p>Hello</p>');
    assert.deepEqual(receivedOptions, { USE_PROFILES: { html: true } });
    assert.equal(TaskUtils.sanitizeTaskHtml(unsafeHtml), '&lt;p onclick=&quot;run()&quot;&gt;Hello&lt;script&gt;alert(1)&lt;/script&gt;&lt;/p&gt;');
});
