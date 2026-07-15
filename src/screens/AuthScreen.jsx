import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { Keyframe } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { Glass } from '../components/ui/Glass';
import { GradientBg } from '../components/ui/GradientBg';
import { radii } from '../theme/tokens';
import { DUR } from '../theme/motion';
import { showToast } from '../lib/toast';
import { relTime } from '../lib/time';
import {
  forgotRequest,
  login,
  resendOtp,
  resetPassword,
  signup,
  verifyOtp,
  verifyResetOtp,
} from '../lib/auth';
import { Field } from '../components/form/Field';
import { CodeInput } from '../components/form/CodeInput';

/* ── Password strength scorer (0-4) — ported from web AuthPage.jsx ─────── */
function scorePassword(v) {
  let s = 0;
  if (v.length >= 6) {
    s++;
  }
  if (v.length >= 10) {
    s++;
  }
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) {
    s++;
  }
  if (/\d/.test(v) || /[^\w]/.test(v)) {
    s++;
  }
  return s;
}
const STRENGTH_LABELS = [
  'strength · gentle',
  'strength · weak',
  'strength · weak',
  'strength · good',
  'strength · strong',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "— N attempts left" suffix for a wrong-code error (server sends attemptsLeft).
const attemptsSuffix = n =>
  Number.isFinite(n) ? ` — ${n} attempt${n === 1 ? '' : 's'} left` : '';

/* ── Small themed pieces ───────────────────────────────────────────────── */
function Head({ kicker, title, sub }) {
  const { t } = useTheme();
  return (
    <View style={styles.head}>
      <Text style={[styles.kicker, { color: t.inkFaint }]}>{kicker}</Text>
      <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
      <Text style={[styles.sub, { color: t.inkSoft }]}>{sub}</Text>
    </View>
  );
}

function LinkText({ onPress, testID, children }) {
  const { t } = useTheme();
  return (
    <Text
      onPress={onPress}
      testID={testID}
      style={[styles.link, { color: t.accent }]}>
      {children}
    </Text>
  );
}

function SubmitButton({ label, pendingLabel, pending, disabled, onPress, testID }) {
  const { t } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.submit,
        { backgroundColor: t.accent, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}>
      <Text style={[styles.submitText, { color: t.surface }]}>
        {pending ? pendingLabel : label}
      </Text>
    </Pressable>
  );
}

function Strength({ score }) {
  const { t } = useTheme();
  return (
    <View style={styles.strength}>
      <View style={styles.strengthBar}>
        {[1, 2, 3, 4].map(i => (
          <View
            key={i}
            style={[
              styles.strengthSeg,
              { backgroundColor: i <= score ? t.accent : t.line },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.strengthLabel, { color: t.inkFaint }]}>
        {STRENGTH_LABELS[score]}
      </Text>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  AuthScreen — step machine ported from web AuthPage.jsx:                */
/*  'form' (signin/signup) / 'otp' / 'device-limit' / 'forgot-request' /   */
/*  'forgot-code' / 'forgot-newpw'. Success needs no callback — the auth   */
/*  lib persists the session and notifies App via subscribeAuth.           */
/* ══════════════════════════════════════════════════════════════════════ */
export default function AuthScreen() {
  const { t } = useTheme();
  const [mode, setMode] = useState('signin');
  const [step, setStep] = useState('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  // Hard device-cap picker: the active devices to choose from + the cap.
  const [deviceSessions, setDeviceSessions] = useState([]);
  const [deviceLimitN, setDeviceLimitN] = useState(0);

  const isSignup = mode === 'signup';
  const pwScore = scorePassword(password);

  /* ── Resend cooldown countdown ──────────────────────────────────────── */
  useEffect(() => {
    if (resendCooldown <= 0) {
      return undefined;
    }
    const id = setInterval(
      () => setResendCooldown(s => (s <= 1 ? 0 : s - 1)),
      1000,
    );
    return () => clearInterval(id);
  }, [resendCooldown]);

  const switchMode = useCallback(next => {
    setMode(next);
    setStep('form');
    setOtpCode('');
    setNewPassword('');
    setErrors({});
    setFormError('');
  }, []);

  const backToForm = useCallback(() => {
    setStep('form');
    setOtpCode('');
    setNewPassword('');
    setErrors({});
    setFormError('');
  }, []);

  /* ── Validation (form step) ─────────────────────────────────────────── */
  const validate = useCallback(() => {
    const e = {};
    if (isSignup && !name.trim()) {
      e.name = 'your name, please.';
    }
    if (!email.trim()) {
      e.email = 'an email is needed.';
    } else if (!EMAIL_RE.test(email.trim())) {
      e.email = 'that email looks off.';
    }
    if (!password) {
      e.password = 'a password is needed.';
    } else if (password.length < 6) {
      e.password = 'at least six characters.';
    }
    return e;
  }, [isSignup, name, email, password]);

  // Advance to the OTP step (shared by signup + login-of-unverified).
  const goToOtp = useCallback(addr => {
    setPendingEmail(addr);
    setStep('otp');
    setOtpCode('');
    setErrors({});
    setFormError('');
    setResendCooldown(60);
  }, []);

  const toDeviceLimit = useCallback(r => {
    setDeviceSessions(r.sessions ?? []);
    setDeviceLimitN(r.limit ?? 0);
    setStep('device-limit');
  }, []);

  /* ── Submit (sign in / sign up) ─────────────────────────────────────── */
  const handleSubmit = useCallback(async () => {
    setFormError('');
    const v = validate();
    if (Object.keys(v).length) {
      setErrors(v);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const r = isSignup
        ? await signup(name.trim(), email.trim(), password)
        : await login(email.trim(), password);
      if (r?.pendingVerification) {
        goToOtp(r.email ?? email.trim());
        return;
      }
      if (r?.code === 'device_limit') {
        toDeviceLimit(r);
        return;
      }
      // Signed in — the auth lib persisted the session and notified App.
    } catch (err) {
      if (err?.code === 'device_limit') {
        toDeviceLimit(err);
        return;
      }
      const msg = err?.message || 'something went wrong.';
      showToast(msg);
      setFormError(msg);
    } finally {
      setPending(false);
    }
  }, [validate, isSignup, name, email, password, goToOtp, toDeviceLimit]);

  /* ── Device-cap picker: remove a device, then sign in here ──────────── */
  const handleEvict = useCallback(
    async sessionId => {
      setFormError('');
      setPending(true);
      try {
        const r = await login(email.trim(), password, sessionId);
        if (r?.code === 'device_limit') {
          setDeviceSessions(r.sessions ?? []);
          setDeviceLimitN(r.limit ?? 0);
          showToast('still at the limit — remove another.');
          return;
        }
        if (r?.pendingVerification) {
          goToOtp(r.email ?? email.trim());
          return;
        }
      } catch (err) {
        if (err?.code === 'device_limit') {
          setDeviceSessions(err.sessions ?? []);
          setDeviceLimitN(err.limit ?? 0);
          showToast('still at the limit — remove another.');
          return;
        }
        const m = err?.message || 'could not sign in.';
        showToast(m);
        setFormError(m);
      } finally {
        setPending(false);
      }
    },
    [email, password, goToOtp],
  );

  /* ── Verify signup code ─────────────────────────────────────────────── */
  const handleVerify = useCallback(async () => {
    if (otpCode.length !== 6) {
      return;
    }
    setFormError('');
    setPending(true);
    try {
      const r = await verifyOtp(pendingEmail, otpCode);
      if (r?.code === 'device_limit') {
        toDeviceLimit(r);
        return;
      }
    } catch (err) {
      if (err?.code === 'device_limit') {
        toDeviceLimit(err);
        return;
      }
      setFormError(
        (err?.message || 'verification failed.') +
          attemptsSuffix(err?.attemptsLeft),
      );
      // Stale/locked code → let them resend right away.
      if (['expired', 'no_code', 'locked', 'signup_expired'].includes(err?.code)) {
        setResendCooldown(0);
      }
    } finally {
      setPending(false);
    }
  }, [otpCode, pendingEmail, toDeviceLimit]);

  /* ── Resend code (signup OTP or reset code, per step) ───────────────── */
  const handleResendCode = useCallback(async () => {
    if (resendCooldown > 0 || !pendingEmail) {
      return;
    }
    setFormError('');
    const isReset = step === 'forgot-code' || step === 'forgot-newpw';
    try {
      if (isReset) {
        await forgotRequest(pendingEmail);
      } else {
        await resendOtp(pendingEmail);
      }
      setResendCooldown(60);
      // A new code invalidates the old one — back to entering the fresh code.
      if (isReset) {
        setStep('forgot-code');
        setOtpCode('');
      }
      showToast('code sent.');
    } catch (err) {
      if (err?.code === 'cooldown' && err.retryAfterSec) {
        setResendCooldown(err.retryAfterSec);
      } else {
        const m = err?.message || 'could not resend code.';
        setFormError(m);
        showToast(m);
      }
    }
  }, [resendCooldown, pendingEmail, step]);

  /* ── Forgot password — request a code ───────────────────────────────── */
  const handleForgotRequest = useCallback(async () => {
    setFormError('');
    const addr = email.trim();
    if (!addr || !EMAIL_RE.test(addr)) {
      setErrors({ email: 'that email looks off.' });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await forgotRequest(addr);
      setPendingEmail(addr);
      setStep('forgot-code');
      setOtpCode('');
      setNewPassword('');
      setResendCooldown(60);
    } catch (err) {
      if (err?.code === 'cooldown' && err.retryAfterSec) {
        // A code was sent recently — still advance to the code step.
        setPendingEmail(addr);
        setStep('forgot-code');
        setOtpCode('');
        setNewPassword('');
        setResendCooldown(err.retryAfterSec);
      } else {
        const m = err?.message || 'could not send code.';
        setFormError(m);
        showToast(m);
      }
    } finally {
      setPending(false);
    }
  }, [email]);

  /* ── Reset — step 1: verify the code without consuming it ───────────── */
  const handleVerifyResetCode = useCallback(async () => {
    setFormError('');
    if (otpCode.length !== 6) {
      setFormError('enter the 6-digit code.');
      return;
    }
    setPending(true);
    try {
      await verifyResetOtp(pendingEmail, otpCode);
      setNewPassword('');
      setErrors({});
      setStep('forgot-newpw');
    } catch (err) {
      setFormError(
        (err?.message || 'that code isn’t right.') +
          attemptsSuffix(err?.attemptsLeft),
      );
      if (['expired', 'no_code', 'locked'].includes(err?.code)) {
        setResendCooldown(0);
      }
    } finally {
      setPending(false);
    }
  }, [otpCode, pendingEmail]);

  /* ── Reset — step 2: set the new password (server re-verifies code) ─── */
  const handleResetPassword = useCallback(async () => {
    setFormError('');
    if (newPassword.length < 6) {
      setErrors({ password: 'at least six characters.' });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await resetPassword(pendingEmail, otpCode, newPassword);
      switchMode('signin'); // back to sign-in (resets step + sub-state)
      setEmail(pendingEmail); // prefill their email
      setPassword(''); // fresh password entry
      setFormError('password updated — sign in with your new password.');
    } catch (err) {
      // If the code went stale between steps, bounce back to the code step.
      if (['expired', 'no_code', 'locked', 'mismatch', 'bad_format'].includes(err?.code)) {
        setFormError(
          (err?.message || 'that code is no longer valid.') +
            attemptsSuffix(err?.attemptsLeft),
        );
        setStep('forgot-code');
        if (['expired', 'no_code', 'locked'].includes(err?.code)) {
          setResendCooldown(0);
        }
      } else {
        setFormError(err?.message || 'reset failed.');
      }
    } finally {
      setPending(false);
    }
  }, [otpCode, newPassword, pendingEmail, switchMode]);

  /* ── Shared render bits ─────────────────────────────────────────────── */
  const errorLine = !!formError && (
    <Text style={[styles.formError, { color: t.accent }]}>{formError}</Text>
  );

  const resendLine = (
    <View style={styles.foot}>
      {resendCooldown > 0 ? (
        <Text style={[styles.footText, { color: t.inkFaint }]}>
          resend code in {resendCooldown}s
        </Text>
      ) : (
        <Text style={[styles.footText, { color: t.inkFaint }]}>
          didn’t get it?{' '}
          <LinkText testID="auth-resend" onPress={handleResendCode}>
            resend code.
          </LinkText>
        </Text>
      )}
    </View>
  );

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <SafeAreaView style={styles.root}>
      {/* The web auth page's warm art panel, full-bleed behind a frosted card. */}
      <GradientBg
        angle={140}
        stops={[
          { offset: 0, color: '#b89a78' },
          { offset: 0.55, color: '#8a6645' },
          { offset: 1, color: '#5a4128' },
        ]}
      />
      <GradientBg
        radial
        stops={[
          { offset: 0, color: '#e8cfae', opacity: 0.35 },
          { offset: 1, color: '#e8cfae', opacity: 0 },
        ]}
      />
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView overScrollMode="always"
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.wordmark}>AURA</Text>
          <Animated.View entering={authRise} style={styles.card}>
            <Glass radius={radii.auth} style={styles.cardGlass}>
            <View style={styles.cardInner}>
            {/* ──────────── Sign in / sign up ──────────── */}
            {step === 'form' && (
              <>
                <Head
                  kicker={isSignup ? 'create account · new' : 'sign in · returning'}
                  title={isSignup ? 'create your account.' : 'welcome back.'}
                  sub={
                    isSignup
                      ? 'quick setup — aura starts learning from your first song.'
                      : 'sign in and pick up where you left off.'
                  }
                />
                {isSignup && (
                  <Field
                    label="name"
                    testID="auth-name"
                    placeholder="what’s your name?"
                    value={name}
                    onChangeText={setName}
                    error={errors.name}
                    autoCapitalize="words"
                  />
                )}
                <Field
                  label="email"
                  testID="auth-email"
                  placeholder="you@somewhere.com"
                  value={email}
                  onChangeText={setEmail}
                  error={errors.email}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
                <Field
                  label="password"
                  testID="auth-password"
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  error={errors.password}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  labelRight={
                    !isSignup ? (
                      <LinkText
                        testID="auth-forgot"
                        onPress={() => {
                          setErrors({});
                          setFormError('');
                          setStep('forgot-request');
                        }}>
                        forgot?
                      </LinkText>
                    ) : null
                  }
                />
                {isSignup && <Strength score={pwScore} />}
                {errorLine}
                <SubmitButton
                  testID="auth-submit"
                  label={isSignup ? 'create account' : 'sign in'}
                  pendingLabel="one moment…"
                  pending={pending}
                  disabled={pending}
                  onPress={handleSubmit}
                />
                <View style={styles.foot}>
                  <Text style={[styles.footText, { color: t.inkFaint }]}>
                    {isSignup ? 'have an account? ' : 'new to aura? '}
                    <LinkText
                      testID="auth-switch-mode"
                      onPress={() => switchMode(isSignup ? 'signin' : 'signup')}>
                      {isSignup ? 'sign in instead.' : 'create an account.'}
                    </LinkText>
                  </Text>
                </View>
              </>
            )}

            {/* ──────────── Verify signup code ──────────── */}
            {step === 'otp' && (
              <>
                <Head
                  kicker="verify · check your email"
                  title="almost there."
                  sub={
                    <>
                      check your email for a 6-digit code — we sent it to{' '}
                      <Text style={{ color: t.ink }}>{pendingEmail}</Text>.
                    </>
                  }
                />
                <CodeInput value={otpCode} onChange={setOtpCode} testID="auth-otp" />
                {errorLine}
                <SubmitButton
                  testID="auth-verify"
                  label="verify"
                  pendingLabel="verifying…"
                  pending={pending}
                  disabled={pending || otpCode.length !== 6}
                  onPress={handleVerify}
                />
                {resendLine}
                <View style={styles.foot}>
                  <LinkText testID="auth-otp-back" onPress={backToForm}>
                    wrong email? go back.
                  </LinkText>
                </View>
              </>
            )}

            {/* ──────────── Device limit — pick one to remove ──────────── */}
            {step === 'device-limit' && (
              <>
                <Head
                  kicker={`device limit · ${deviceLimitN} max`}
                  title="device limit reached."
                  sub={`your account is signed in on ${deviceSessions.length} device${
                    deviceSessions.length === 1 ? '' : 's'
                  }. remove one to sign in here.`}
                />
                <View style={styles.devices}>
                  {deviceSessions.map(s => {
                    const seen = relTime(s.lastSeenAt);
                    const loc =
                      [s.city, s.country].filter(Boolean).join(', ') ||
                      'location unknown';
                    return (
                      <View
                        key={s.id}
                        style={[
                          styles.device,
                          { backgroundColor: t.surface, borderColor: t.line },
                        ]}>
                        <View style={styles.deviceInfo}>
                          <Text style={[styles.deviceLabel, { color: t.ink }]}>
                            {s.deviceLabel || 'unknown device'}
                          </Text>
                          <Text style={[styles.deviceMeta, { color: t.inkFaint }]}>
                            {loc}
                            {seen ? ` · active ${seen}` : ''}
                          </Text>
                        </View>
                        <Pressable
                          testID={`auth-evict-${s.id}`}
                          accessibilityRole="button"
                          disabled={pending}
                          onPress={() => handleEvict(s.id)}
                          style={[
                            styles.deviceRemove,
                            { borderColor: t.accent },
                            pending && styles.dim,
                          ]}>
                          <Text style={[styles.deviceRemoveText, { color: t.accent }]}>
                            remove & sign in
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
                {errorLine}
                <View style={styles.foot}>
                  <LinkText testID="auth-device-back" onPress={backToForm}>
                    back to sign in.
                  </LinkText>
                </View>
              </>
            )}

            {/* ──────────── Forgot — request a code ──────────── */}
            {step === 'forgot-request' && (
              <>
                <Head
                  kicker="reset · forgot password"
                  title="reset your password."
                  sub="enter your email. if it’s registered, we’ll send a 6-digit reset code."
                />
                <Field
                  label="email"
                  testID="forgot-email"
                  placeholder="you@somewhere.com"
                  value={email}
                  onChangeText={setEmail}
                  error={errors.email}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
                {errorLine}
                <SubmitButton
                  testID="forgot-submit"
                  label="send reset code"
                  pendingLabel="sending…"
                  pending={pending}
                  disabled={pending}
                  onPress={handleForgotRequest}
                />
                <View style={styles.foot}>
                  <LinkText testID="forgot-back" onPress={backToForm}>
                    back to sign in.
                  </LinkText>
                </View>
              </>
            )}

            {/* ──────────── Forgot — step 1: enter the code ──────────── */}
            {step === 'forgot-code' && (
              <>
                <Head
                  kicker="reset · check your email"
                  title="enter your code."
                  sub={
                    <>
                      if an account exists for{' '}
                      <Text style={{ color: t.ink }}>{pendingEmail}</Text>, we’ve
                      sent a 6-digit code.
                    </>
                  }
                />
                <CodeInput value={otpCode} onChange={setOtpCode} testID="reset-otp" />
                {errorLine}
                <SubmitButton
                  testID="reset-continue"
                  label="continue"
                  pendingLabel="checking…"
                  pending={pending}
                  disabled={pending || otpCode.length !== 6}
                  onPress={handleVerifyResetCode}
                />
                {resendLine}
                <View style={styles.foot}>
                  <LinkText testID="reset-back" onPress={backToForm}>
                    back to sign in.
                  </LinkText>
                </View>
              </>
            )}

            {/* ──────────── Forgot — step 2: set new password ──────────── */}
            {step === 'forgot-newpw' && (
              <>
                <Head
                  kicker="reset · new password"
                  title="set a new password."
                  sub="your code checked out. choose a new password for your account."
                />
                <Field
                  label="new password"
                  testID="reset-password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  error={errors.password}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                />
                <Strength score={scorePassword(newPassword)} />
                {errorLine}
                <SubmitButton
                  testID="reset-submit"
                  label="reset password"
                  pendingLabel="resetting…"
                  pending={pending}
                  disabled={pending || newPassword.length < 6}
                  onPress={handleResetPassword}
                />
                <View style={styles.foot}>
                  <LinkText
                    testID="reset-reenter"
                    onPress={() => {
                      setFormError('');
                      setOtpCode('');
                      setStep('forgot-code');
                    }}>
                    re-enter code.
                  </LinkText>
                </View>
              </>
            )}
            </View>
            </Glass>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Web auth-rise: 600ms settle up into place.
const authRise = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 18 }, { scale: 0.985 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
}).duration(DUR.authRise);

const styles = StyleSheet.create({
  root: { flex: 1 },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  wordmark: {
    alignSelf: 'center',
    color: 'rgba(248,240,226,0.92)',
    fontFamily: 'HankenGrotesk-Bold',
    fontSize: 18,
    letterSpacing: 6,
    marginBottom: 28,
  },
  card: { alignSelf: 'center', maxWidth: 420, width: '100%' },
  cardGlass: { width: '100%' },
  cardInner: { paddingHorizontal: 24, paddingVertical: 30 },
  head: { marginBottom: 20 },
  kicker: {
    fontFamily: 'HankenGrotesk-Medium',
    fontSize: 11,
    letterSpacing: 0.88,
    marginBottom: 8,
    textTransform: 'lowercase',
  },
  title: {
    fontFamily: 'HankenGrotesk-Bold',
    fontSize: 28,
    letterSpacing: -0.42,
    marginBottom: 8,
  },
  sub: { fontFamily: 'HankenGrotesk-Regular', fontSize: 14, lineHeight: 20 },
  formError: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  submit: {
    alignItems: 'center',
    borderRadius: 12,
    marginTop: 4,
    paddingVertical: 14,
  },
  submitText: { fontSize: 15, fontWeight: '600' },
  link: { fontWeight: '600' },
  foot: { alignItems: 'center', marginTop: 16 },
  footText: { fontSize: 13 },
  strength: {
    alignItems: 'center',
    columnGap: 10,
    flexDirection: 'row',
    marginBottom: 14,
    marginTop: 2,
  },
  strengthBar: { columnGap: 4, flex: 1, flexDirection: 'row' },
  strengthSeg: { borderRadius: 2, flex: 1, height: 3 },
  strengthLabel: { fontSize: 11 },
  devices: { marginBottom: 4, rowGap: 10 },
  device: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    columnGap: 12,
    flexDirection: 'row',
    padding: 14,
  },
  deviceInfo: { flex: 1 },
  deviceLabel: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  deviceMeta: { fontSize: 12 },
  deviceRemove: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deviceRemoveText: { fontSize: 12, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
