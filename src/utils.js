// utils.js

let debounceTimeout;

export function debounce(func, delay) {
    return function (...args) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => func.apply(this, args), delay);
    };
}

export function waitForElement(selector, onAdd, onRemove, onChange, ignoreExisting) {
    const processExistingElements = () => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => onAdd(el));
    };

    if (onAdd && !ignoreExisting) {
        processExistingElements();
    }

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (onAdd) {
                mutation.addedNodes.forEach(node => {
                    if (node.matches && node.matches(selector)) onAdd(node);
                    node.querySelectorAll?.(selector).forEach(el => onAdd(el));
                });
            }

            if (onRemove) {
                mutation.removedNodes.forEach(node => {
                    if (node.matches && node.matches(selector)) onRemove(node);
                    node.querySelectorAll?.(selector).forEach(el => onRemove(el));
                });
            }

            if(onChange) {
                if (mutation.type === "attributes") {
                    const attributeName = mutation.attributeName;
                    const oldValue = mutation.oldValue;
                    const newValue = mutation.target.getAttribute(attributeName);

                    if (oldValue !== newValue) {
                        onChange(attributeName, oldValue, newValue, mutation.target);
                    }
                }
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: !!onChange });
    return observer;
}


export function observeChanges(target, callback, subtree) {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === "attributes") {
                const attributeName = mutation.attributeName;
                const oldValue = mutation.oldValue;
                const newValue = mutation.target.getAttribute(attributeName);

                // Only log changes if there's a difference
                if (oldValue !== newValue) {
                    callback(attributeName, oldValue, newValue, mutation.target);
                }
            }
        });
    });

    observer.observe(target, {
        attributes: true,
        attributeOldValue: true,
        subtree: !!subtree,
    });

    return observer;
}


export function observeVisibilityChange($element, callback) {
    const target = $element[0]; // Get the DOM element from the jQuery object

    const observer = new MutationObserver(() => {
        // Check visibility using jQuery
        const isVisible = $element.is(":visible");
        callback(isVisible);
    });

    // Observe changes to attributes and child nodes
    observer.observe(target, {
        attributes: true,
        childList: true,
        subtree: false, // Only observe the target element
    });

    // Optional: Return a function to stop observing
    return () => observer.disconnect();
}

export function splitTerms(input) {
    return input.split(/\s+/).filter(term => term.length > 0); // Split by spaces
}

export function extractLastTerm(input) {
    let terms = splitTerms(input);
    return terms.length > 0 ? terms[terms.length - 1] : "";
}
