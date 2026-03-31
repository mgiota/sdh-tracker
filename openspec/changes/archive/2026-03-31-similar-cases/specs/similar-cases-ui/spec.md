## ADDED Requirements

### Requirement: Find similar cases button
The case detail page SHALL show a "Find similar cases" button alongside the existing action buttons.

#### Scenario: Button visible
- **WHEN** an engineer is on any case detail page
- **THEN** the "Find similar cases" button is visible

### Requirement: Loading state
While the backend processes the request, the button SHALL show a loading indicator and be disabled to prevent duplicate requests.

#### Scenario: Request in progress
- **WHEN** the button is clicked and the request is pending
- **THEN** the button is disabled and shows a loading label (e.g. "Searching…")

### Requirement: Results modal
Upon receiving results, the system SHALL display a modal with up to 3 similar cases. Each result shows: case title as a clickable link to the case detail page, status badge, and similarity explanation.

#### Scenario: Results returned
- **WHEN** the backend returns one or more similar cases
- **THEN** a modal opens showing each result with title link, status badge, and explanation

#### Scenario: Title link navigation
- **WHEN** the engineer clicks a case title in the modal
- **THEN** they are navigated to that case's detail page and the modal closes

### Requirement: Empty state
If no similar cases are found, the modal SHALL still open and display a friendly message.

#### Scenario: No results
- **WHEN** the backend returns an empty array
- **THEN** the modal opens with a message such as "No similar cases found yet."

### Requirement: Dismissable modal
The modal SHALL be dismissable via a close button or clicking the backdrop.

#### Scenario: Dismiss modal
- **WHEN** the engineer clicks the close button or backdrop
- **THEN** the modal closes
