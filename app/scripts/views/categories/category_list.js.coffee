define ['views/categories/category'],
(CategoryView) ->
  class CategoryList extends Marionette.CollectionView
    itemView: CategoryView