const test = require('node:test');
const assert = require('node:assert/strict');
const MeetingUtils = require('../src/meeting-utils.js');

const participant = id => ({ id, name: `Person ${id}` });

test('builds a roster that labels spoken, speaking, next, remaining, and absent participants', () => {
    const [alreadySpoke, speaking, next, remaining, absent] = ['spoken', 'active', 'next', 'later', 'absent'].map(participant);

    const roster = MeetingUtils.buildRoster(
        [alreadySpoke],
        speaking,
        [next, remaining],
        [absent],
    );

    assert.deepEqual(roster.map(({ name, status, canNavigate }) => ({ name, status, canNavigate })), [
        { name: 'Person spoken', status: 'Already spoke', canNavigate: true },
        { name: 'Person active', status: 'Speaking', canNavigate: true },
        { name: 'Person next', status: 'Goes next', canNavigate: true },
        { name: 'Person later', status: 'Remaining', canNavigate: true },
        { name: 'Person absent', status: 'Absent', canNavigate: true },
    ]);
});

test('already-spoken queued participants do not take the Goes next tag from the first unspoken participant', () => {
    const [active, interrupted, next, spoken] = ['active', 'interrupted', 'next', 'spoken'].map(participant);

    const roster = MeetingUtils.buildRoster(
        [active, interrupted, spoken],
        active,
        [interrupted, next],
    );

    assert.deepEqual(roster.map(({ name, status }) => [name, status]), [
        ['Person spoken', 'Already spoke'],
        ['Person active', 'Speaking'],
        ['Person interrupted', 'Remaining'],
        ['Person next', 'Goes next'],
    ]);
});

test('navigating removes the selected participant and queues the interrupted speaker next', () => {
    const [current, selected, next, later] = ['current', 'selected', 'next', 'later'].map(participant);

    assert.deepEqual(MeetingUtils.queueInterruptedSpeaker([selected, next, later], current, selected), [current, next, later]);
    assert.deepEqual(MeetingUtils.queueInterruptedSpeaker([selected, current, next], current, selected), [current, next]);
    assert.deepEqual(MeetingUtils.queueInterruptedSpeaker([selected, next], null, selected), [next]);
});
