import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { loadSettingsAccountViewModel } from "@/lib/settings/loader";
import type { SettingsAccountViewModel } from "@/lib/settings/view-model";
import { requireUser } from "@/lib/session";

import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { EmailVerificationForm } from "./email-verification-form";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata: Metadata = {
  title: "Settings — TextIQ",
};

/**
 * Pure view-model -> markup composition for {@link SettingsPage}
 * (issue #1928).
 *
 * Given the already-loaded account view model, decides which sections
 * render — the email-verification badge/form pair, the connected-accounts
 * list filtered to available providers, and the password/profile/danger-zone
 * forms wired with their view-model props. Extracted from the async default
 * export so the composition is unit-testable without exercising
 * `requireUser`/`loadSettingsAccountViewModel`, which require a live session
 * and database.
 */
export function renderSettingsAccountView(
  viewModel: SettingsAccountViewModel,
): ReactNode {
  return (
    <main className="flex flex-1 flex-col items-center bg-ds-surface-sunken px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ds-text-primary">
            Settings
          </h1>
          <p className="text-sm text-ds-text-secondary">
            Manage your account profile.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-ds-text-primary">
              Profile
            </h2>
            <p className="text-sm text-ds-text-secondary">
              Update your display name.
            </p>
          </div>
          <ProfileForm
            initialName={viewModel.profile.initialName}
            email={viewModel.profile.email}
          />
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-ds-text-primary">
                Email verification
              </h2>
              {viewModel.emailVerification.isVerified ? (
                <span className="rounded-ds-pill bg-ds-success/10 px-2 py-0.5 text-xs font-medium text-ds-success">
                  {viewModel.emailVerification.badgeLabel}
                </span>
              ) : (
                <span className="rounded-ds-pill bg-ds-surface-sunken px-2 py-0.5 text-xs font-medium text-ds-text-secondary">
                  {viewModel.emailVerification.badgeLabel}
                </span>
              )}
            </div>
            <p className="text-sm text-ds-text-secondary">
              {viewModel.emailVerification.message}
            </p>
          </div>
          {viewModel.emailVerification.isVerified ? null : (
            <EmailVerificationForm />
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-ds-text-primary">
              {viewModel.password.heading}
            </h2>
            <p className="text-sm text-ds-text-secondary">
              {viewModel.password.description}
            </p>
          </div>
          <PasswordForm hasPassword={viewModel.password.hasPassword} />
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-ds-text-primary">
              Connected accounts
            </h2>
            <p className="text-sm text-ds-text-secondary">
              Sign-in methods linked to your account.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {viewModel.connectedAccounts
              .filter((account) => account.available)
              .map((account) => (
                <li
                  key={account.provider}
                  className="flex items-center justify-between rounded-lg border border-ds-border-subtle bg-ds-surface-sunken px-4 py-3"
                >
                  <span className="text-sm font-medium text-ds-text-primary">
                    {account.label}
                  </span>
                  {account.connected ? (
                    <span className="rounded-ds-pill bg-ds-success/10 px-2 py-0.5 text-xs font-medium text-ds-success">
                      Connected
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-ds-text-secondary">
                      Not connected
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-ds-text-primary">
              Your data
            </h2>
            <p className="text-sm text-ds-text-secondary">
              Download a JSON copy of your account and documents.
            </p>
          </div>
          <div>
            <a
              href={viewModel.links.accountExport}
              download
              className="inline-flex h-11 items-center justify-center rounded-full border border-ds-border-strong bg-ds-surface-base px-6 text-sm font-medium text-ds-text-primary transition hover:bg-ds-surface-sunken"
            >
              Download my data
            </a>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-ds-danger/30 bg-ds-surface-base p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-ds-danger">
              Danger zone
            </h2>
            <p className="text-sm text-ds-text-secondary">
              Irreversible actions for your account.
            </p>
          </div>
          <DeleteAccountForm email={viewModel.profile.email} />
        </section>

        <Link
          href={viewModel.links.billing}
          className="text-sm font-medium text-ds-text-secondary underline-offset-4 transition hover:text-ds-text-primary hover:underline"
        >
          Billing &amp; Plan →
        </Link>

        <Link
          href={viewModel.links.documents}
          className="text-sm font-medium text-ds-text-secondary underline-offset-4 transition hover:text-ds-text-primary hover:underline"
        >
          ← Back to documents
        </Link>
      </div>
    </main>
  );
}

export default async function SettingsPage() {
  const sessionUser = await requireUser(redirect);
  const viewModel = await loadSettingsAccountViewModel(sessionUser.id);

  if (!viewModel) {
    redirect("/login");
  }

  return renderSettingsAccountView(viewModel);
}
