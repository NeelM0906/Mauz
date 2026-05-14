import { History, Settings } from "lucide-react";
import { useState } from "react";
import { BrandLogo } from "./BrandLogo";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { SettingsPanel } from "./SettingsPanel";

type DesktopTab = "history" | "settings";

const DESKTOP_TABS: Array<{
  id: DesktopTab;
  label: string;
  icon: typeof History;
}> = [
  {
    id: "history",
    label: "Prev chats",
    icon: History
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings
  }
];

export function DesktopApp(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<DesktopTab>("history");

  return (
    <main className="desktop-app">
      <aside className="desktop-sidebar" aria-label="MauzAI desktop navigation">
        <div className="desktop-brand">
          <BrandLogo className="desktop-brand-logo" />
          <div>
            <h1>MauzAI</h1>
            <p>Desktop assistant</p>
          </div>
        </div>

        <nav className="desktop-nav" aria-label="MauzAI sections">
          {DESKTOP_TABS.map((tab) => {
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon aria-hidden="true" size={17} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="desktop-main">
        {activeTab === "history" ? (
          <ChatHistoryPanel allowContinue chrome="desktop" />
        ) : (
          <SettingsPanel chrome="desktop" />
        )}
      </section>
    </main>
  );
}
