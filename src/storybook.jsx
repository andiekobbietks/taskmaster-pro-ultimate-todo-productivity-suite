/**
 * storybook.jsx — renders every component in isolation, the way a Storybook
 * would. Each block is one "story": a single component with a specific set
 * of props, so a reviewer can see every variant and state side by side.
 *
 * Built with the real components from src/components, so what you see here is
 * what ships. The page is a static entry point — no Storybook runtime, no
 * dependency to install.
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";

import { Button } from "./components/Button";
import { Input } from "./components/Input";
import { Card } from "./components/Card";
import { Badge } from "./components/Badge";
import { Modal } from "./components/Modal";
import { Banner } from "./components/Banner";
import { EmptyState } from "./components/EmptyState";
import {
  EmailListItem, EmailDetail, InboxSplitView, EmailListSkeleton,
} from "./components/InboxPrimitives";

const SAMPLE_EMAIL = {
  id: "inbox-1",
  sender: "notifications@devpost.com",
  subject: "Build, Ship, Shape: Amazon Developer Hackathon - submission deadline extended",
  received_at: Date.now() - 3600000,
  body_preview:
    "The submission deadline for the Amazon Developer Hackathon has been extended to Oct 30, 2026 at 11:59pm EDT.\n\n" +
    "Remember that you can resubmit your project up to 5 times before the deadline. If you need a template for your README, the organiser guide is available in the Resources tab.\n\n" +
    "Good luck!",
  body_html: "<p>The submission deadline has been extended.</p>",
  has_attachments: true,
  attachment_names: ["organiser-guide.pdf", "assets.zip"],
  is_platform: true,
  platform: "devpost",
  ticket_id: "hack-amazon",
  match_confidence: 1,
  match_method: "content",
  read: false,
  processed: false,
  created_at: Date.now(),
};

const UNMATCHED_EMAIL = {
  ...SAMPLE_EMAIL,
  id: "inbox-2",
  sender: "hello@devpost.com",
  subject: "Your Devpost account - please verify your email address",
  body_preview: "We noticed your email address has not been verified. Please follow the link to confirm it so you can register for competitions.",
  has_attachments: false,
  attachment_names: [],
  ticket_id: null,
  match_confidence: 0,
  match_method: "ambiguous",
};

function Story({ title, description, children, className = "" }) {
  return (
    <section className="mb-12" data-story={title}>
      <div className="mb-3">
        <h2 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
        )}
      </div>
      <div
        className={`bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 ${className}`}
      >
        {children}
      </div>
    </section>
  );
}

function Row({ children, gap = "gap-3" }) {
  return <div className={`flex flex-wrap items-center ${gap}`}>{children}</div>;
}

function Label({ children }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
      {children}
    </span>
  );
}

function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [text, setText] = useState("");
  const [banner, setBanner] = useState(true);

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0A0E1A] p-8 font-sans antialiased">
      <div className="max-w-5xl mx-auto">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            TaskMaster Pro
          </h1>
          <p className="text-neutral-500 mt-1">
            Component library — every variant and state, in isolation.
          </p>
        </header>

        {/* Button */}
        <Story
          title="Button"
          description="Four variants, three sizes, plus disabled and loading states."
        >
          <div className="space-y-4">
            <Row>
              <Label>Variants</Label>
            </Row>
            <Row>
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </Row>
            <Row>
              <Label>Sizes</Label>
            </Row>
            <Row>
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </Row>
            <Row>
              <Label>States</Label>
            </Row>
            <Row>
              <Button disabled>Disabled</Button>
              <Button loading>Loading</Button>
            </Row>
          </div>
        </Story>

        {/* Input */}
        <Story
          title="Input"
          description="Text entry with label, placeholder, required marker and error state."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Task Title" placeholder="Enter a title" value={text} onChange={(e) => setText(e.target.value)} />
            <Input label="Prize" placeholder="$0" />
            <Input label="Required field" required value="" onChange={() => {}} />
            <Input label="With error" error="Deadline must be a future date" value="yesterday" onChange={() => {}} />
            <Input type="number" label="Team size" placeholder="1" />
            <Input type="date" label="Submission deadline" />
          </div>
        </Story>

        {/* Card */}
        <Story
          title="Card"
          description="The surface every other component sits on. Border, shadow and dark mode."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <p className="text-sm font-semibold">Default</p>
              <p className="text-xs text-neutral-500 mt-1">
                Static surface. No hover effect.
              </p>
            </Card>
            <Card className="p-4" hover>
              <p className="text-sm font-semibold">Hover</p>
              <p className="text-xs text-neutral-500 mt-1">
                Gains a shadow and a stronger border on hover.
              </p>
            </Card>
          </div>
        </Story>

        {/* Badge */}
        <Story
          title="Badge"
          description="Status, priority and platform indicators."
        >
          <div className="space-y-3">
            <Row>
              <Label>Variants</Label>
            </Row>
            <Row>
              <Badge variant="success">Open</Badge>
              <Badge variant="warning">Urgent</Badge>
              <Badge variant="danger">Closed</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="neutral">Manual</Badge>
              <Badge variant="brand">Brand</Badge>
            </Row>
            <Row>
              <Label>Sizes</Label>
            </Row>
            <Row>
              <Badge variant="success" size="sm">Small</Badge>
              <Badge variant="success" size="md">Medium</Badge>
            </Row>
          </div>
        </Story>

        {/* Banner */}
        <Story
          title="Banner"
          description="Failure and status messaging. Dismissible, with an optional retry."
        >
          <div className="space-y-4">
            {banner && (
              <Banner
                variant="error"
                title="Failed to load"
                message="Could not reach the server. Check your connection and try again."
                onDismiss={() => setBanner(false)}
                onRetry={() => {}}
              />
            )}
            <Banner
              variant="success"
              title="Saved"
              message="Your changes were written."
            />
            <Banner
              variant="warning"
              title="Rate limited"
              message="Too many requests. Try again in a minute."
            />
          </div>
        </Story>

        {/* EmptyState */}
        <Story
          title="EmptyState"
          description="Shown when a view has nothing to display."
        >
          <EmptyState
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            title="No hackathons yet"
            description="Add hackathons to track deadlines, eligibility, and submissions."
            actionLabel="Add Hackathon"
            onAction={() => {}}
          />
        </Story>

        {/* Modal */}
        <Story
          title="Modal"
          description="Overlay dialog for forms and confirmations."
        >
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
          <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Create New Task">
            <div className="space-y-4">
              <Input label="Title" placeholder="What needs doing?" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>Create</Button>
              </div>
            </div>
          </Modal>
        </Story>

        {/* Inbox primitives */}
        <Story
          title="Email list row"
          description="One row. Unread state, platform badge, linked ticket, match confidence, actions."
        >
          <div className="-mx-6 -my-2">
            <EmailListItem
              email={SAMPLE_EMAIL}
              isSelected={false}
              panelOpen={false}
              onSelect={() => {}}
              onToggleProcessed={() => {}}
              onDelete={() => {}}
            />
            <EmailListItem
              email={UNMATCHED_EMAIL}
              isSelected={false}
              panelOpen={false}
              onSelect={() => {}}
              onToggleProcessed={() => {}}
              onDelete={() => {}}
            />
          </div>
        </Story>

        <Story
          title="Email detail panel"
          description="Header, sender avatar, body and attachments. Bodies render as plain text."
        >
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden h-[420px]">
            <EmailDetail email={SAMPLE_EMAIL} onClose={() => {}} />
          </div>
        </Story>

        <Story
          title="Inbox split view"
          description="List beside the detail panel. From md up the list narrows to 380px."
        >
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden h-[420px]">
            <InboxSplitView selected={selected} onClose={() => setSelected(null)}>
              <div className="flex-1 overflow-y-auto">
                <EmailListItem
                  email={SAMPLE_EMAIL}
                  isSelected={selected?.id === SAMPLE_EMAIL.id}
                  panelOpen={selected !== null}
                  onSelect={(e) => setSelected(e)}
                  onToggleProcessed={() => {}}
                  onDelete={() => {}}
                />
                <EmailListItem
                  email={UNMATCHED_EMAIL}
                  isSelected={selected?.id === UNMATCHED_EMAIL.id}
                  panelOpen={selected !== null}
                  onSelect={(e) => setSelected(e)}
                  onToggleProcessed={() => {}}
                  onDelete={() => {}}
                />
              </div>
            </InboxSplitView>
          </div>
        </Story>

        <Story
          title="Inbox skeleton"
          description="Loading placeholders while the inbox is fetched."
        >
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
            <EmailListSkeleton count={5} />
          </div>
        </Story>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
