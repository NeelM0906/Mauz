import { ArrowLeft, History, LoaderCircle, MessageSquareText, X } from "lucide-react";
import { useEffect } from "react";
import type { ChatConversation, ChatHistoryGroup } from "@mauzai/shared";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { FormattedAnswer } from "./FormattedAnswer";

export function ChatHistoryPanel(): React.JSX.Element {
  const {
    chatHistory,
    selectedConversation,
    historyError,
    historyLoading,
    backToMenu,
    setChatHistory,
    setHistoryError,
    setHistoryLoading,
    setSelectedConversation
  } = useMauzStore();

  useEffect(() => {
    let disposed = false;

    const loadHistory = async (): Promise<void> => {
      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const history = await mauzClient.listChatHistory();

        if (!disposed) {
          setChatHistory(history);
        }
      } catch (error) {
        if (!disposed) {
          setHistoryError(error instanceof Error ? error.message : "Could not load Mauz chats.");
        }
      } finally {
        if (!disposed) {
          setHistoryLoading(false);
        }
      }
    };

    if (chatHistory === null) {
      void loadHistory();
    }

    return () => {
      disposed = true;
    };
  }, [chatHistory, setChatHistory, setHistoryError, setHistoryLoading]);

  const handleBack = async (): Promise<void> => {
    if (selectedConversation !== null) {
      setSelectedConversation(null);
      return;
    }

    await mauzClient.showMenu();
    backToMenu();
  };

  const handleSelectConversation = async (id: string): Promise<void> => {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      setSelectedConversation(await mauzClient.getChatConversation({ id }));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not open that Mauz chat.");
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <section className="history-panel" aria-label="Previous Mauz chats">
      <header className="history-header">
        <button className="icon-button" type="button" aria-label="Back" onClick={() => void handleBack()}>
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <div>
          <h1>{selectedConversation === null ? "Prev chats" : selectedConversation.title}</h1>
          <p>
            {selectedConversation === null
              ? "Saved text-only Mauz conversations."
              : formatConversationDate(selectedConversation)}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close Mauz"
          onClick={() => void mauzClient.close()}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      {historyError !== null ? <p className="history-error">{historyError}</p> : null}
      {historyLoading && selectedConversation === null ? (
        <div className="history-loading">
          <LoaderCircle aria-hidden="true" className="spin" size={16} />
          <span>Loading chats</span>
        </div>
      ) : null}
      {!historyLoading && selectedConversation === null ? (
        <HistoryList
          groups={chatHistory?.groups ?? []}
          onSelectConversation={(id) => void handleSelectConversation(id)}
        />
      ) : null}
      {selectedConversation !== null ? <ConversationView conversation={selectedConversation} /> : null}
    </section>
  );
}

function HistoryList({
  groups,
  onSelectConversation
}: {
  groups: ChatHistoryGroup[];
  onSelectConversation(id: string): void;
}): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <div className="history-empty">
        <History aria-hidden="true" size={18} />
        <span>No previous Mauz chats yet.</span>
      </div>
    );
  }

  return (
    <div className="history-list" aria-label="Previous chat groups">
      {groups.map((group) => (
        <section key={group.dateLabel} className="history-date-group">
          <h2>{group.dateLabel}</h2>
          <div>
            {group.conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className="history-conversation"
                onClick={() => onSelectConversation(conversation.id)}
              >
                <MessageSquareText aria-hidden="true" size={15} />
                <span>
                  <strong>{conversation.title}</strong>
                  <small>{conversation.preview || "No preview"}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ConversationView({ conversation }: { conversation: ChatConversation }): React.JSX.Element {
  return (
    <div className="conversation-view">
      {conversation.messages.map((message) => (
        <article key={message.id} className="conversation-message" data-role={message.role}>
          <span>{message.role === "user" ? "You" : "Mauz"}</span>
          {message.role === "assistant" ? (
            <FormattedAnswer answer={message.content} />
          ) : (
            <p>{message.content}</p>
          )}
        </article>
      ))}
    </div>
  );
}

function formatConversationDate(conversation: ChatConversation): string {
  return new Date(conversation.createdAt).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  });
}
