import React, { useState, useEffect } from 'react';
import './HelpModal.css';

const HelpModal = ({ isOpen, onClose }) => {
    const [animationClass, setAnimationClass] = useState('');

    useEffect(() => {
        if (isOpen) {
            setAnimationClass('help-modal-enter');
        } else {
            setAnimationClass('help-modal-exit');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="help-modal-overlay">
            <div className={`help-modal-content ${animationClass}`} onClick={(e) => e.stopPropagation()}>
                
                <div className="help-modal-header">
                    <div className="help-modal-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                    </div>
                    <h2>Welcome to TeamChat!</h2>
                    <p>Your AI-powered collaborative workspace</p>
                </div>

                <div className="help-modal-body">
                    <div className="help-section">
                        <h3>Chat Types</h3>
                        <ul>
                            <li><strong>Group Chat:</strong> Everyone can see messages. @mention Claude to get AI responses.</li>
                            <li><strong>Individual Chats:</strong> Private conversations with Claude AI (e.g., "Your Name's Chat").</li>
                        </ul>
                    </div>

                    <div className="help-section">
                        <h3>Cross-Chat References</h3>
                        <ul>
                            <li>Type <code>@ChatName</code> to reference another chat's conversation.</li>
                            <li>Example: <code>@John's Chat what did we discuss?</code></li>
                            <li>Claude will include relevant context from the referenced chat.</li>
                        </ul>
                    </div>

                    <div className="help-section">
                        <h3>Web Search</h3>
                        <ul>
                            <li>Ask Claude to search the web for current information.</li>
                            <li>Example: <code>@Claude search for latest AI news</code></li>
                            <li>Claude will provide real links and up-to-date information.</li>
                        </ul>
                    </div>

                    <div className="help-section">
                        <h3>Pro Tips</h3>
                        <ul>
                            <li>Switch between chats using the sidebar.</li>
                            <li>In group chats, @mention Claude to get AI responses.</li>
                            <li>Individual chats automatically trigger Claude responses.</li>
                            <li>Use inline references to connect conversations across chats.</li>
                        </ul>
                    </div>
                </div>

                <div className="help-modal-footer">
                    <button className="help-modal-button" onClick={onClose}>
                        Got it! Vamos!
                    </button>
                </div>
            </div>
        </div>
    );
};

export default HelpModal;
