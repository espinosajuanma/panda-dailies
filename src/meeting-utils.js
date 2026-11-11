(function (root, factory) {
    const meetingUtils = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = meetingUtils;
    }
    root.MeetingUtils = meetingUtils;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
    const participantKey = participant => participant && participant.id != null
        ? String(participant.id)
        : participant && participant.name;

    const buildRoster = (spoken = [], active = null, queued = [], absent = []) => {
        const rows = [];
        const seen = new Set();
        const activeKey = participantKey(active);
        const queuedKeys = new Set(queued.map(participantKey));
        const spokenKeys = new Set(spoken.map(participantKey));

        const add = (participant, status) => {
            const key = participantKey(participant);
            if (!participant || key == null || seen.has(key)) return;
            seen.add(key);
            rows.push({ participant, name: participant.name, status, canNavigate: true });
        };

        spoken.forEach(participant => {
            const key = participantKey(participant);
            if (key !== activeKey && !queuedKeys.has(key)) add(participant, 'Already spoke');
        });

        add(active, 'Speaking');
        let hasNextUnspoken = false;
        queued.forEach(participant => {
            const key = participantKey(participant);
            const isNextUnspoken = !hasNextUnspoken && !spokenKeys.has(key);
            if (isNextUnspoken) hasNextUnspoken = true;
            add(participant, isNextUnspoken ? 'Goes next' : 'Remaining');
        });
        absent.forEach(participant => add(participant, 'Absent'));

        return rows;
    };

    const queueInterruptedSpeaker = (queued, current, selected) => {
        const selectedKey = participantKey(selected);
        const remaining = queued.filter(participant => participantKey(participant) !== selectedKey);
        if (!current || participantKey(current) === selectedKey) return remaining;
        const currentKey = participantKey(current);
        return [current, ...remaining.filter(participant => participantKey(participant) !== currentKey)];
    };

    return { buildRoster, queueInterruptedSpeaker };
});
