import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Sheet } from '../components/ui/Sheet';
import { ConfirmCard } from '../components/ui/ConfirmCard';
import { subscribeConfirm, resolveConfirm } from '../lib/confirm';

// The house confirm — a bottom sheet in the app's own language instead of the
// OS's gray Alert box. One instance lives in App; lib/confirm.js routes every
// confirm() here. The card itself is ConfirmCard, shared with ConfirmPopup;
// this file owns only the container: backdrop, back button and drag-down all
// read as cancel.
export function ConfirmSheet() {
  const [req, setReq] = useState(null);
  useEffect(() => subscribeConfirm(setReq), []);

  if (!req) {
    return null;
  }
  return (
    <Sheet
      animated={!req.instant}
      onClose={() => resolveConfirm(false)}
      closeLabel="cancel"
    >
      <ConfirmCard
        style={styles.card}
        title={req.title}
        body={req.body}
        action={req.action}
        danger={req.danger}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // The sheet's own breathing room around the card — the 2pt the title and the
  // action row used to carry themselves, moved out to the container that wants
  // them (the popup's padded card does not).
  card: {
    marginTop: 2,
    marginBottom: 2,
  },
});
