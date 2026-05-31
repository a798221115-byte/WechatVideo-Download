export function toggleId(selected, id) {
  if (!id) return selected;
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
  return selected;
}

export function selectAllVisible(selected, ids) {
  for (const id of ids) {
    if (id) selected.add(id);
  }
  return selected;
}

export function invertVisible(selected, ids) {
  for (const id of ids) {
    toggleId(selected, id);
  }
  return selected;
}

export function clearSelection(selected) {
  selected.clear();
  return selected;
}
