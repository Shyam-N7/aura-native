import React, { useCallback, useEffect, useRef } from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  FadeOut,
  ReduceMotion,
  SlideOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { radii } from '../../theme/tokens';
import { DUR, EASE, SPRING } from '../../theme/motion';

// The bottom-sheet chassis every overlay sheet mounts in: backdrop + grip +
// slide-in card, dismissed by backdrop tap, the hardware back button, or
// dragging the card down (follow the finger, commit on distance or velocity,
// spring back otherwise). Owners keep their open state and unmount on
// `onClose` — the exiting animation plays from wherever the drag released, so
// a fling keeps its momentum instead of snapping back before leaving.
//
// Sheets whose body can outgrow the screen pass `header`: the header stays in
// the drag zone while children scroll underneath (dragging the list itself
// must keep scrolling it — only the header/grip dismisses, like every
// platform sheet).
//
// The OPEN is chassis-owned: a shared-value rise started on first layout, so
// every sheet slides in — including ones nested under another component's
// null gate, which the old `entering` layout animation had to skip (field
// report: the queue options sheet popped open). A cancelled shared value
// survives any unmount; it is the entering/exiting layout-animation pair
// reanimated 4.2.3/Fabric aborts natively on when a view is removed
// mid-flight — this device's documented crash class.
//
// `animated={false}` therefore now opts out of only the EXIT pair. Still
// required for any sheet nested under another component's null gate (e.g.
// the queue options sheet inside QueueSheet) and for confirms whose accept
// tears down the tree (`confirm({ instant: true })`): those pop closed.
export function Sheet({
  onClose,
  closeLabel,
  header = null,
  animated = true,
  children,
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const dragY = useSharedValue(0);
  const cardH = useSharedValue(0);
  // Open progress: 0 = parked below the screen, 1 = at rest. Started on the
  // first layout pass (the slide distance IS the measured card height — until
  // then the card hides behind opacity 0, so there is no first-frame flash).
  const p = useSharedValue(0);
  const entered = useRef(false);
  const onCardLayout = e => {
    cardH.value = e.nativeEvent.layout.height;
    if (!entered.current) {
      entered.current = true;
      p.value = reduced
        ? 1
        : withTiming(1, { duration: DUR.upNext, easing: EASE.enter });
    }
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const dismiss = useCallback(() => onClose(), [onClose]);

  const pan = Gesture.Pan()
    // A clear downward pull only — presses inside the sheet stay presses,
    // upward/horizontal movement is not a dismissal.
    .activeOffsetY(12)
    .failOffsetY(-12)
    .failOffsetX([-16, 16])
    .onUpdate(e => {
      'worklet';
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd(e => {
      'worklet';
      if (e.velocityY > 900 || dragY.value > cardH.value * 0.33) {
        runOnJS(dismiss)();
      } else if (reduced) {
        dragY.value = 0;
      } else {
        dragY.value = withSpring(0, SPRING.snapback);
      }
    });

  // Drag and open ride one transform; the backdrop dims in step with the rise.
  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardH.value === 0 ? 0 : 1,
    transform: [{ translateY: dragY.value + (1 - p.value) * cardH.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, p.value * 1.6),
  }));

  const grip = <View style={[styles.grip, { backgroundColor: t.line }]} />;

  // A native Modal window, not a zIndex layer: sheets open from anywhere —
  // including deep inside a screen, where no zIndex can beat the app-level
  // dock overlay (field report: the dock painted over the playlist visibility
  // sheet). A separate window wins by construction. animationType="none"
  // because the chassis plays its own open/close; the inner
  // GestureHandlerRootView is required for the pan gesture to work inside a
  // Modal on Android.
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, styles.stack]}>
          <Animated.View
            exiting={
              animated
                ? FadeOut.duration(DUR.dot).reduceMotion(ReduceMotion.System)
                : undefined
            }
            style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={onClose}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            exiting={
              animated
                ? SlideOutDown.duration(DUR.dot).reduceMotion(
                    ReduceMotion.System,
                  )
                : undefined
            }
            onLayout={onCardLayout}
            style={[
              styles.card,
              header && styles.cardCapped,
              { backgroundColor: t.surface, paddingBottom: insets.bottom + 14 },
              cardStyle,
            ]}
          >
            {/* Surface-colored bleed below the card. On this device the Modal
                window doesn't honor navigationBarTranslucent, so the card's
                bottom sits at the gesture-bar top and the dimmed page showed
                through the strip beneath it. This paints that strip the card's
                own colour; harmless (off-screen) where the Modal IS edge-to-
                edge. */}
            <View
              pointerEvents="none"
              style={[styles.bottomBleed, { backgroundColor: t.surface }]}
            />
            {header ? (
              <>
                <GestureDetector gesture={pan}>
                  <View style={styles.body}>
                    {grip}
                    {header}
                  </View>
                </GestureDetector>
                <ScrollView
                  overScrollMode="always"
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.scrollBody}
                >
                  {children}
                </ScrollView>
              </>
            ) : (
              <GestureDetector gesture={pan}>
                <View style={styles.body}>
                  {grip}
                  {children}
                </View>
              </GestureDetector>
            )}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // The Modal window already floats above the whole app; zIndex kept for the
  // ladder's bookkeeping (player 30, queue 40, sheets 50). Never elevation —
  // on a transparent wrapper it's both a stacking trap and the white-slab trap.
  stack: { zIndex: 50 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: 8,
  },
  cardCapped: { maxHeight: '72%' },
  // Bleeds below the card to paint the gesture-bar strip the card's colour
  // (see the note at the usage site). Tall enough to cover any nav bar.
  bottomBleed: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    height: 180,
  },
  body: { paddingHorizontal: 18 },
  scrollBody: { paddingHorizontal: 18, flexGrow: 0 },
  grip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
});
