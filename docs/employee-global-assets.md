# Employee Global Asset Visibility

Currently, the `AssetsService` actively filters the `GET /assets` list for `EMPLOYEE` roles so that they can only see assets that are *currently checked out to them* (unless they are assigned a department scope). 

To fulfill your request of allowing employees to see all company assets, we need to remove this strict filtering. 

## Proposed Changes

### `apps/api/src/assets/assets.service.ts`
- **[MODIFY]**: Remove the lines in the `list()` method that enforce the `where.assignments` filter for employees.
- **Security Implications**: Employees will now be able to view all asset names, asset tags, serial numbers, purchase dates, and notes. (Write actions like edit/checkout will remain restricted by the `AssetsController` role guards).

## Verification Plan
1. Run `npx -w @assetmon/api tsc --noEmit`.
2. Rebuild the API docker container.
3. As the Employee test account, navigate to the **Inventory > Assets** tab. All company assets will now be visible in the list.
