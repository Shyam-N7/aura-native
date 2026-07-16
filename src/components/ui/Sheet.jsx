import React, { useCallback, useEffect } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { radii } from '../../theme/tokens';
import { DUR, SPRING } from '../../theme/motion';

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
// `animated={false}` opts out of the entering/exiting pair. Required for any
// sheet nested under ANOTHER component's null gate (e.g. the queue options
// sheet inside QueueSheet): the parent can hard-unmount it mid-animation, and
// reanimated 4.2.3/Fabric aborts natively on unmount-mid-entering/exiting —
// this device's documented crash class. Such sheets pop instead of sliding.
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

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  const grip = <View style={[styles.grip, { backgroundColor: t.line }]} />;

  return (
    <View style={[StyleSheet.absoluteFill, styles.stack]}>
      <Animated.View
        entering={
          animated
            ? FadeIn.duration(DUR.dot).reduceMotion(ReduceMotion.System)
            : undefined
        }
        exiting={
          animated
            ? FadeOut.duration(DUR.dot).reduceMotion(ReduceMotion.System)
            : undefined
        }
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        entering={
          animated
            ? SlideInDown.duration(DUR.upNext).reduceMotion(
                ReduceMotion.System,
              )
            : undefined
        }
        exiting={
          animated
            ? SlideOutDown.duration(DUR.dot).reduceMotion(ReduceMotion.System)
            : undefined
        }
        onLayout={e => {
          cardH.value = e.nativeEvent.layout.height;
        }}
        style={[
          styles.card,
          header && styles.cardCapped,
          { backgroundColor: t.surface, paddingBottom: insets.bottom + 14 },
          dragStyle,
        ]}
      >
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
  );
}

const styles = StyleSheet.create({
  // Top of the overlay ladder (player 30, queue 40) so a sheet opened from a
  // queue row or the player renders over them, not underneath. zIndex only —
  // elevation on a transparent wrapper is both a stacking trap and the
  // Android white-slab trap.
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
