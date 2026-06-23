// Test-only secrets so the pure MFA/crypto helpers (which read these at call
// time) work without a real environment. Never used outside the test run.
import 'reflect-metadata';

process.env.OTP_PEPPER = process.env.OTP_PEPPER || 'unit-test-otp-pepper-0123456789abcdef';
process.env.OTP_PEPPER_VERSION = process.env.OTP_PEPPER_VERSION || '1';
process.env.JWT_MFA_TICKET_SECRET = process.env.JWT_MFA_TICKET_SECRET || 'unit-test-mfa-ticket-secret-0123456789';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'unit-test-encryption-key-0123456789abcdef';
