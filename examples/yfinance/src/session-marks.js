// Session marks: price lines the host places from the chart menu for the
// length of a session. They show the three drawing policies working
// together. The user can select one (to read it, copy it or raise an alert
// from it) but not move, restyle or delete it; it is left out of every saved
// layout; and it stays out of the Objects dock. Only the host takes them
// away again, through its own "Clear session marks" row, which is the one
// place `force` is passed.

/** The policy every session mark carries. */
export const SESSION_MARK_POLICY = Object.freeze({ editable: false, persistent: false, listed: false });

// Dashed and thin, in the theme's line colour, so a mark reads as the
// host's reference rather than one of the user's own lines.
const MARK_STYLE = { lineWidth: 1, lineStyle: 'dashed' };

/** Place a mark at `point` on the price pane. */
export function addSessionMark(draw, point) {
  return draw.add({
    tool: 'horizontal-line', paneIndex: 0, style: { ...MARK_STYLE },
    points: [{ time: point.time, price: point.price }],
    policy: { ...SESSION_MARK_POLICY },
  });
}

/** The marks on `draw`: in this host, exactly the drawings that are never saved. */
export function sessionMarks(draw) {
  return draw ? draw.drawings().filter((d) => d.policy?.persistent === false) : [];
}

/** Remove every mark, and nothing else. Returns how many went. */
export function clearSessionMarks(draw) {
  const ids = sessionMarks(draw).map((d) => d.id);
  if (ids.length) draw.removeMany(ids, { force: true });
  return ids.length;
}
