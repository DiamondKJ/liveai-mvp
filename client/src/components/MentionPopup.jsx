import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

const MentionPopup = ({ users, query, onSelect, anchorElement, onNavigateSelection }) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const popupRef = useRef(null);

    // Filter users based on query
    const filteredUsers = users.filter(user =>
        user.name.toLowerCase().includes(query.toLowerCase())
    );

    // Reset selected index when query changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    // Handle keyboard navigation for the popup
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!filteredUsers.length) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, filteredUsers.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (filteredUsers[selectedIndex]) {
                    onSelect(filteredUsers[selectedIndex].name);
                }
            }
            if (onNavigateSelection) onNavigateSelection(e);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [filteredUsers, selectedIndex, onSelect, onNavigateSelection]);

    // Calculate position dynamically based on the textarea's cursor
    const [position, setPosition] = useState({ top: 0, left: 0 });
    useEffect(() => {
        if (anchorElement && popupRef.current) {
            const anchorRect = anchorElement.getBoundingClientRect();
            const cursorCoords = getCaretCoordinates(anchorElement, anchorElement.selectionStart);
            setPosition({
                top: window.scrollY + anchorRect.top + cursorCoords.top - popupRef.current.offsetHeight - 10,
                left: window.scrollX + anchorRect.left + cursorCoords.left,
            });
        }
    }, [anchorElement, query, filteredUsers.length]);

    if (!filteredUsers.length || !anchorElement) return null;

    return ReactDOM.createPortal(
        <div
            ref={popupRef}
            style={{ top: `${position.top}px`, left: `${position.left}px` }}
            className="fixed w-56 bg-[#2A2B32] border border-gray-600 rounded-lg shadow-xl z-50 text-white font-inter"
        >
            <ul className="max-h-60 overflow-y-auto">
                {filteredUsers.map((user, index) => (
                    <li
                        key={user.id}
                        onClick={() => onSelect(user.name)}
                        className={`px-3 py-2 text-sm cursor-pointer ${
                            index === selectedIndex ? 'bg-blue-600 text-white' : 'hover:bg-[#2A2B32]'
                        }`}
                    >
                        {user.name}
                    </li>
                ))}
            </ul>
        </div>,
        document.getElementById('portal-root') 
    );
};

export default MentionPopup;

// --- Helper function to get caret coordinates ---
function getCaretCoordinates(element, position) {
    const is = (el, prop) => el.nodeName === prop;
    const isInput = is(element, 'INPUT') || is(element, 'TEXTAREA');
    const isContentEditable = element.contentEditable === 'true';
    const div = document.createElement('div');
    document.body.appendChild(div);
    const style = div.style;
    const computed = window.getComputedStyle(element);
    style.whiteSpace = 'pre-wrap';
    style.wordWrap = 'break-word';
    style.position = 'absolute';
    style.visibility = 'hidden';
    style.overflow = 'hidden';
    style.fontFamily = computed.fontFamily;
    style.fontSize = computed.fontSize;
    style.lineHeight = computed.lineHeight;
    style.padding = computed.padding;
    style.border = computed.border;
    style.boxSizing = computed.boxSizing;
    if (isInput) {
        style.width = element.clientWidth + 'px';
    }
    const span = document.createElement('span');
    span.textContent = element.value.substring(0, position);
    div.appendChild(span);
    const coordinates = {
        top: span.offsetHeight,
        left: span.offsetWidth,
    };
    span.textContent += element.value.substring(position);
    document.body.removeChild(div);
    return coordinates;
}