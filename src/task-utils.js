(function (root, factory) {
    const taskUtils = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = taskUtils;
    }
    root.TaskUtils = taskUtils;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
    const statusGroups = {
        Done: ['completed', 'inreview'],
        Current: ['inprogress'],
        Remaining: ['inreview', 'todo'],
        All: ['todo', 'inprogress', 'inreview', 'completed'],
    };

    const normalizeValue = value => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]/g, '');

    const asArray = value => Array.isArray(value) ? value : [];

    const rolesFor = task => {
        if (Array.isArray(task.roles)) return task.roles;
        return task.relation ? [task.relation] : [];
    };

    const reviewerIdFor = feedback => {
        const reviewer = feedback && feedback.reviewer;
        return reviewer && typeof reviewer === 'object' ? reviewer.id : reviewer;
    };

    const feedbackForUser = (task, userId) => asArray(task.reviewFeedbacks)
        .find(feedback => String(reviewerIdFor(feedback)) === String(userId));

    const reviewerFeedbackState = (task, userId) => {
        const feedback = feedbackForUser(task, userId);
        return normalizeValue(feedback ? feedback.feedback : 'pending') || 'pending';
    };

    const reviewerFeedbackLabel = (task, userId) => {
        if (!rolesFor(task).includes('Reviewer')) return '';
        const labels = {
            pending: 'Pending review',
            approved: 'Approved',
            changesrequested: 'Changes requested',
        };
        return labels[reviewerFeedbackState(task, userId)] || 'Pending review';
    };

    const matchesTaskView = (task, view, userId) => {
        const roles = rolesFor(task);
        const status = normalizeValue(task.status);
        const isAssignee = roles.includes('Assignee');
        const isReviewer = roles.includes('Reviewer');

        if (view === 'All') return isAssignee || isReviewer;
        if (view === 'Done') {
            return (isAssignee && status === 'completed') ||
                (isReviewer && status === 'inreview' && ['approved', 'changesrequested'].includes(reviewerFeedbackState(task, userId)));
        }
        if (view === 'Current') return isAssignee && status === 'inprogress';
        if (view === 'Remaining') {
            return (isAssignee && status === 'todo') ||
                (isReviewer && status === 'inreview' && reviewerFeedbackState(task, userId) === 'pending');
        }
        return false;
    };

    const compareTaskNumbers = (left, right) => {
        const hasLeft = left !== undefined && left !== null && String(left).trim() !== '';
        const hasRight = right !== undefined && right !== null && String(right).trim() !== '';
        if (hasLeft !== hasRight) return hasLeft ? -1 : 1;
        const leftNumber = Number(left);
        const rightNumber = Number(right);
        if (hasLeft && hasRight && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
        return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
    };

    const sortTasks = (tasks, view) => {
        const statusOrder = statusGroups[view] || statusGroups.All;
        return [...tasks].sort((a, b) => {
            const aStatus = normalizeValue(a.status);
            const bStatus = normalizeValue(b.status);
            const aRank = statusOrder.indexOf(aStatus);
            const bRank = statusOrder.indexOf(bStatus);
            const statusDifference = (aRank < 0 ? statusOrder.length : aRank) - (bRank < 0 ? statusOrder.length : bRank);
            if (statusDifference) return statusDifference;

            const numberDifference = compareTaskNumbers(a.number, b.number);
            if (numberDifference) return numberDifference;
            const titleDifference = String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
            if (titleDifference) return titleDifference;
            return String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true });
        });
    };

    const mergeTasks = (assignedTasks, reviewedTasks) => {
        const tasksById = new Map();
        let missingId = 0;

        const addTasks = (tasks, role) => {
            asArray(tasks).forEach(source => {
                if (!source) return;
                const id = source.id == null ? `missing-${missingId++}` : String(source.id);
                let task = tasksById.get(id);

                if (!task) {
                    task = {
                        id,
                        number: source.number,
                        title: source.title || source.label || source.name || 'Untitled task',
                        status: source.status || '',
                        type: source.type || '',
                        description: source.description || '',
                        taskNotes: source.notes ?? source.taskNotes ?? source.comments ?? source.note ?? null,
                        reviewFeedbacks: [],
                        roles: [],
                    };
                    tasksById.set(id, task);
                } else {
                    task.number ??= source.number;
                    task.title = task.title === 'Untitled task' ? (source.title || source.label || source.name || task.title) : task.title;
                    task.status ||= source.status || '';
                    task.type ||= source.type || '';
                    task.description ||= source.description || '';
                    task.taskNotes ??= source.notes ?? source.taskNotes ?? source.comments ?? source.note ?? null;
                }

                if (!task.roles.includes(role)) task.roles.push(role);
                asArray(source.reviewFeedbacks).forEach(feedback => {
                    const feedbackKey = `${reviewerIdFor(feedback) || ''}:${normalizeValue(feedback.feedback)}`;
                    const alreadyAdded = task.reviewFeedbacks.some(existing =>
                        `${reviewerIdFor(existing) || ''}:${normalizeValue(existing.feedback)}` === feedbackKey);
                    if (!alreadyAdded) task.reviewFeedbacks.push(feedback);
                });
            });
        };

        addTasks(assignedTasks, 'Assignee');
        addTasks(reviewedTasks, 'Reviewer');
        return [...tasksById.values()];
    };

    const normalizeNotes = value => {
        if (value == null || value === '') return [];
        if (typeof value === 'string') return value.trim() ? [value] : [];
        if (Array.isArray(value)) return value.flatMap(normalizeNotes);
        if (typeof value === 'object') {
            if (Array.isArray(value.items)) return normalizeNotes(value.items);
            for (const key of ['text', 'content', 'note', 'label', 'description']) {
                if (typeof value[key] === 'string') return normalizeNotes(value[key]);
            }
        }
        return [];
    };

    const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]);

    const sanitizeTaskHtml = (value, sanitizer) => {
        const html = String(value ?? '');
        if (sanitizer && typeof sanitizer.sanitize === 'function') {
            return sanitizer.sanitize(html, { USE_PROFILES: { html: true } });
        }
        return escapeHtml(html);
    };

    const extractTaskDetails = (source, fallback = {}) => {
        const task = source && (source.item || source.task || source);
        const description = task && typeof task.description === 'string' ? task.description : fallback.description || '';
        const noteValue = task ? (task.notes ?? task.taskNotes ?? task.comments ?? task.note) : undefined;
        return {
            description,
            notes: normalizeNotes(noteValue ?? fallback.taskNotes),
        };
    };

    const filterAndSortTasks = (tasks, view, userId) =>
        sortTasks(asArray(tasks).filter(task => matchesTaskView(task, view, userId)), view);

    return {
        extractTaskDetails,
        filterAndSortTasks,
        matchesTaskView,
        mergeTasks,
        normalizeNotes,
        reviewerFeedbackLabel,
        sanitizeTaskHtml,
        sortTasks,
    };
});
